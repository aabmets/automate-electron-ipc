/*
 *   Apache License 2.0
 *
 *   Copyright (c) 2024, Mattias Aabmets
 *
 *   The contents of this file are subject to the terms and conditions defined in the License.
 *   You may not use, modify, or distribute this file except in compliance with the License.
 *
 *   SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from "node:events";
import fsp from "node:fs/promises";
import path from "node:path";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import {
   createFakeElectron,
   createFakePreloadElectron,
   createSource,
   loadGenerated,
} from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
});

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

/** The `Appointment` of the fixture, with the types that structured clone cannot tell apart. */
const appointment = () => ({
   at: new Date("2026-10-09T10:00:00.000Z"),
   tags: new Set(["a", "b"]),
   attendees: new Map([["ada", 2]]),
   budget: 10n,
});

type Listener = (...args: any[]) => unknown;

/** The listeners of a fake `ipcMain` or `ipcRenderer`, by channel, which `off` removes from. */
function createRegistry() {
   const listeners = new Map<string, Set<Listener>>();
   return {
      add: (wire: string, listener: Listener) => {
         listeners.set(wire, (listeners.get(wire) ?? new Set()).add(listener));
      },
      remove: (wire: string, listener: Listener) => listeners.get(wire)?.delete(listener),
      of: (wire: string) => [...(listeners.get(wire) ?? [])],
   };
}

/**
 * Loads the generated main bindings and preload script of a fixture next to each other, with the
 * serializer of the fixture, and connects them the way Electron does: whatever crosses is cloned.
 */
async function connect(fixture = "serializer", options: { validateSender?: boolean } = {}) {
   project = await runFixture(fixture);
   const read = (name: string) => fsp.readFile(path.join(project?.dir ?? "", "ipc", name), "utf8");
   const serializer = loadGenerated(await read("serializer.ts"), {});
   const spied = {
      serialize: vi.fn(serializer.serialize),
      deserialize: vi.fn(serializer.deserialize),
   };

   // Both sides keep their listeners, so that `off` and `once` work as they do in Electron.
   const mainOn = createRegistry();
   const handlers = new Map<string, Listener>();
   const main = createFakeElectron();
   main.ipcMain.on.mockImplementation(mainOn.add);
   main.ipcMain.off.mockImplementation(mainOn.remove);
   main.ipcMain.handle.mockImplementation((wire: string, handler: Listener) => {
      handlers.set(wire, handler);
   });
   main.ipcMain.removeHandler.mockImplementation((wire: string) => handlers.delete(wire));

   const page = createFakePreloadElectron();
   const pageOn = createRegistry();
   page.electron.ipcRenderer.on.mockImplementation(pageOn.add);
   page.electron.ipcRenderer.removeListener.mockImplementation(pageOn.remove);
   page.electron.ipcRenderer.once.mockImplementation((wire: string, listener: Listener) => {
      const once: Listener = (...args) => {
         pageOn.remove(wire, once);
         return listener(...args);
      };
      pageOn.add(wire, once);
   });
   const toPage = (wire: string, ...args: unknown[]) => {
      for (const listener of pageOn.of(wire)) {
         listener({}, ...structuredClone(args));
      }
   };
   const contents = Object.assign(new EventEmitter(), {
      id: 1,
      getURL: () => "app://.",
      isDestroyed: () => false,
      send: vi.fn(toPage),
   });
   Object.assign(main, {
      webContents: { getAllWebContents: vi.fn(() => [contents]), fromFrame: vi.fn() },
   });

   const validators =
      fixture === "serializer" ? loadGenerated(await read("validators.ts"), {}) : {};
   const mainModules = loadGenerated(project.generated["main.ts"], {
      electron: main,
      "./serializer": spied,
      "./validators": validators,
   });
   loadGenerated(project.generated["preload.ts"], {
      electron: page.electron,
      "./serializer": spied,
   });

   const frame = {
      origin: "app://.",
      detached: false,
      isDestroyed: () => false,
      send: vi.fn(toPage),
      postMessage: vi.fn(),
   };
   const event = { sender: contents, senderFrame: frame };
   page.electron.ipcRenderer.invoke.mockImplementation(async (wire: string, ...args: unknown[]) =>
      handlers.get(wire)?.(event, ...structuredClone(args)),
   );
   page.electron.ipcRenderer.send.mockImplementation((wire: string, ...args: unknown[]) => {
      for (const listener of mainOn.of(wire)) {
         listener(event, ...structuredClone(args));
      }
   });
   if (options.validateSender) {
      mainModules.configureIpc({ validateSender: () => false });
   }
   return {
      ipc: mainModules.ipc as any,
      main: mainModules,
      page: page.exposed.ipc as any,
      pageElectron: page.electron,
      mainElectron: main,
      contents,
      spied,
      event,
      /** The function that the generated main process registered with `ipcMain.handle`. */
      handler: (wire: string) => handlers.get(wire) as Listener,
      /** The listener that the generated main process registered with `ipcMain.on`. */
      mainListener: (wire: string) => mainOn.of(wire)[0],
      /** The listener that the preload script registered with `ipcRenderer.on` or `once`. */
      pageListener: (wire: string) => pageOn.of(wire)[0],
   };
}

describe("fixture serializer, with a module in the project", () => {
   it("generates files that type-check, with the types the page and the main process see", async () => {
      project = await runFixture("serializer");

      expect(await project.typecheck()).toBe("");
   });

   it("fails the type-check when a Date is sent where the signature says it is a number", async () => {
      project = await runFixture("serializer");
      const usage = path.join(project.dir, project.ipcDataDir, "schema-usage.ts");
      const text = await fsp.readFile(usage, "utf8");
      await fsp.writeFile(usage, text.replace("// @ts-expect-error the page sends a Date", "//"));

      expect(await project.typecheck()).toContain("schema-usage.ts");
   });

   it("imports the module in main.ts and in preload.ts, and leaves window.d.ts alone", async () => {
      project = await runFixture("serializer");
      const line =
         'import { serialize as ipcSerialize, deserialize as ipcDeserialize } from "./serializer";';

      expect(project.generated["main.ts"]).toContain(line);
      expect(project.generated["preload.ts"]).toContain(line);
      expect(project.generated["window.d.ts"]).not.toContain("serializ");
   });

   it("sends the arguments as one wire value, and returns the result as one", async () => {
      const { page, ipc, pageElectron } = await connect();
      ipc.getAppointment.handle(async () => appointment());

      await page.getAppointment.invoke(1, new Date(0));

      const [wire, ...sent] = pageElectron.ipcRenderer.invoke.mock.calls[0];
      expect(wire).toBe("autoipc:getAppointment");
      expect(sent).toStrictEqual([{ json: [1, { $: "Date", v: "1970-01-01T00:00:00.000Z" }] }]);
   });
});

describe("generated serializer, invoke", () => {
   it("delivers a Date to the handler and brings a Set, a Map and a bigint back", async () => {
      const { page, ipc } = await connect();
      const handler = vi.fn(async () => appointment());
      ipc.getAppointment.handle(handler);
      const since = new Date("2026-01-02T03:04:05.000Z");

      const result = await page.getAppointment.invoke(7, since);

      expect(handler).toHaveBeenCalledOnce();
      const [, id, received] = handler.mock.calls[0] as unknown as [unknown, number, Date];
      expect(id).toBe(7);
      expect(received).toBeInstanceOf(Date);
      expect(received.toISOString()).toBe(since.toISOString());
      expect(result).toStrictEqual(appointment());
      expect(result.tags).toBeInstanceOf(Set);
      expect(result.attendees).toBeInstanceOf(Map);
   });

   it("serializes a call without arguments and a result that is undefined", async () => {
      const { page, ipc } = await connect();
      ipc.ping.handle(async () => undefined);

      await expect(page.ping.invoke()).resolves.toBeUndefined();
   });

   it("serializes the result of handleOnce as well", async () => {
      const { page, ipc } = await connect();
      ipc.getAppointment.handleOnce(async () => appointment());

      await expect(page.getAppointment.invoke(1, new Date(0))).resolves.toStrictEqual(
         appointment(),
      );
   });

   it("deserializes the arguments before the schema validates them", async () => {
      const { page, ipc } = await connect();
      const when = new Date("2026-05-05T05:05:05.000Z");
      ipc.checked.handle(async (_event: unknown, date: Date) => new Date(date.getTime() + 1000));

      const result = await page.checked.invoke(when);

      expect(result).toStrictEqual(new Date("2026-05-05T05:05:06.000Z"));
   });

   it("rejects a call that the schema refuses, with the validation error", async () => {
      const { ipc, mainElectron, event } = await connect();
      ipc.checked.handle(async (_event: unknown, date: Date) => date);
      const handle = mainElectron.ipcMain.handle.mock.calls.findLast(
         ([name]: [string]) => name === "autoipc:checked",
      )?.[1];

      // A well-formed wire value whose argument is not a Date.
      const reply = await handle(event, { json: ["not a date"] });

      expect(reply).toMatchObject({ ok: false, error: { code: "IPC_VALIDATION" } });
   });

   it("rejects in the page, without a call, when the arguments cannot be serialized", async () => {
      const { page, pageElectron } = await connect();

      const failure = await page.getAppointment.invoke(1, () => 1).catch((e: unknown) => e);

      expect(failure).toStrictEqual({
         name: "IpcSerializationError",
         message:
            "The data cannot be serialized of the channel 'getAppointment': cannot serialize a function",
         code: "IPC_SERIALIZATION",
      });
      expect(pageElectron.ipcRenderer.invoke).not.toHaveBeenCalled();
   });

   it("answers a wire value that cannot be deserialized with an error, and runs no handler", async () => {
      const { ipc, mainElectron, event } = await connect();
      const handler = vi.fn();
      ipc.getAppointment.handle(handler);
      const handle = mainElectron.ipcMain.handle.mock.calls[0][1];

      const reply = await handle(event, { json: [{ $: "Bogus" }] });

      expect(reply).toMatchObject({
         ok: false,
         error: { name: "IpcSerializationError", code: "IPC_SERIALIZATION" },
      });
      expect(handler).not.toHaveBeenCalled();
   });

   it.each([
      ["raw arguments", [1, 2]],
      ["no argument", []],
      ["a wire value that holds no list", [{ json: 5 }]],
   ])(
      "answers %s with an error, since the message is not a serialized list",
      async (_name, args) => {
         const { ipc, mainElectron, event } = await connect();
         ipc.getAppointment.handle(vi.fn());
         const handle = mainElectron.ipcMain.handle.mock.calls[0][1];

         const reply = await handle(event, ...args);

         expect(reply).toMatchObject({ ok: false, error: { code: "IPC_SERIALIZATION" } });
      },
   );

   it("rejects the page with the error when the result cannot be serialized", async () => {
      const { page, ipc } = await connect();
      ipc.getAppointment.handle(async () => ({ at: () => 1 }));

      const failure = await page.getAppointment.invoke(1, new Date(0)).catch((e: unknown) => e);

      expect(failure).toMatchObject({ name: "IpcSerializationError", code: "IPC_SERIALIZATION" });
   });

   it("rejects the page when the answer cannot be deserialized", async () => {
      const { page, pageElectron } = await connect();
      pageElectron.ipcRenderer.invoke.mockResolvedValueOnce({
         ok: true,
         value: { json: { $: "Bogus" } },
      });

      const failure = await page.getAppointment.invoke(1, new Date(0)).catch((e: unknown) => e);

      expect(failure).toMatchObject({ name: "IpcSerializationError", code: "IPC_SERIALIZATION" });
   });

   it("still passes the error of the handler on, as a plain object", async () => {
      const { page, ipc } = await connect();
      ipc.ping.handle(() => {
         throw Object.assign(new Error("nope"), { code: "E_NOPE" });
      });

      await expect(page.ping.invoke()).rejects.toMatchObject({ message: "nope", code: "E_NOPE" });
   });

   it("does not run the deserializer for a sender that is rejected", async () => {
      const { page, ipc, spied } = await connect("serializer", { validateSender: true });
      ipc.getAppointment.handle(vi.fn(async () => appointment()));

      await expect(page.getAppointment.invoke(1, new Date(0))).rejects.toMatchObject({
         code: "IPC_FORBIDDEN",
      });

      // The page serialized its arguments; the main process deserialized nothing.
      expect(spied.deserialize).not.toHaveBeenCalled();
   });
});

describe("generated serializer, send", () => {
   it("delivers the arguments of a send as they were", async () => {
      const { page, ipc } = await connect();
      const listener = vi.fn();
      ipc.logVisit.on(listener);
      const at = new Date("2026-10-09T10:00:00.000Z");

      page.logVisit.send(at, new Map([["a", 1]]));

      expect(listener).toHaveBeenCalledOnce();
      const [, receivedAt, tags] = listener.mock.calls[0];
      expect(receivedAt).toBeInstanceOf(Date);
      expect(receivedAt.toISOString()).toBe(at.toISOString());
      expect(tags).toStrictEqual(new Map([["a", 1]]));
   });

   it("drops a message that cannot be read, and logs it, without throwing into Electron", async () => {
      const { ipc, mainElectron, event } = await connect();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const listener = vi.fn();
      ipc.logVisit.on(listener);
      const onSend = mainElectron.ipcMain.on.mock.calls[0][1];

      expect(() => onSend(event, { json: [{ $: "Bogus" }] })).not.toThrow();
      expect(() => onSend(event, "raw", "arguments")).not.toThrow();

      expect(listener).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(2);
      expect(error.mock.calls[0][0]).toMatchObject({ code: "IPC_SERIALIZATION" });
   });

   it("uses up a once listener on the first message that can be read only", async () => {
      const { page, ipc, mainElectron, event } = await connect();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const listener = vi.fn();
      ipc.logVisit.once(listener);
      const onSend = mainElectron.ipcMain.on.mock.calls[0][1];

      onSend(event, "garbage");
      page.logVisit.send(new Date(0), new Map());
      page.logVisit.send(new Date(0), new Map());

      expect(listener).toHaveBeenCalledOnce();
   });

   it("throws in the page, with the code in the message, when the arguments cannot be serialized", async () => {
      const { page, pageElectron } = await connect();

      expect(() => page.logVisit.send(new Date(0), Symbol("no"))).toThrowError(
         expect.objectContaining({
            code: "IPC_SERIALIZATION",
            message: expect.stringMatching(/^\[IPC_SERIALIZATION\] /),
         }),
      );
      expect(pageElectron.ipcRenderer.send).not.toHaveBeenCalled();
   });
});

describe("generated serializer, emit", () => {
   it("delivers the arguments to a window, to the sender and to every contents", async () => {
      const { page, ipc, contents, event } = await connect();
      const listener = vi.fn();
      page.changed.on(listener);

      ipc.changed.send({ webContents: contents }, appointment());
      ipc.changed.sendToSender(event, appointment());
      ipc.changed.broadcast(appointment());
      ipc.changed.broadcastTo(() => true, appointment());

      expect(listener).toHaveBeenCalledTimes(4);
      expect(listener.mock.calls[0]).toStrictEqual([appointment()]);
      // The wire value is one argument, not the arguments themselves.
      expect(contents.send.mock.calls[0]).toStrictEqual([
         "autoipc:changed",
         { json: [{ $: "Object", v: expect.any(Object) }] },
      ]);
   });

   it("keeps a once listener until a message can be read", async () => {
      const { page, ipc, contents, pageElectron } = await connect();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const listener = vi.fn();
      page.changed.once(listener);
      const onChanged = pageElectron.ipcRenderer.once.mock.calls[0][1];

      onChanged({}, "garbage");
      ipc.changed.send({ webContents: contents }, appointment());

      expect(listener).toHaveBeenCalledOnce();
   });

   it("drops a message that cannot be read in the page, and logs it", async () => {
      const { page, pageElectron } = await connect();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const listener = vi.fn();
      page.changed.on(listener);
      const onChanged = pageElectron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === "autoipc:changed",
      )?.[1];

      expect(() => onChanged({}, { json: { $: "Bogus" } })).not.toThrow();

      expect(listener).not.toHaveBeenCalled();
      expect(error.mock.calls[0][0]).toMatchObject({ code: "IPC_SERIALIZATION" });
   });

   it("throws IpcSerializationError to the caller when the arguments cannot be serialized", async () => {
      const { ipc, contents, main } = await connect();

      const call = () => ipc.changed.send({ webContents: contents }, { at: () => 1 });

      expect(call).toThrowError(main.IpcSerializationError);
      expect(call).toThrowError(
         "The data cannot be serialized of the channel 'changed': cannot serialize a function",
      );
      expect(contents.send).not.toHaveBeenCalled();
   });
});

describe("generated serializer, ask", () => {
   it("sends the question serialized, and resolves with the answer as it was", async () => {
      const { page, ipc, contents } = await connect();
      const responder = vi.fn(
         async (zone: string) => new Date(`2026-01-01T00:00:00.000Z${zone === "UTC" ? "" : ""}`),
      );
      page.askClock.handle(responder);

      const answer = await ipc.askClock.invoke({ webContents: contents }, "UTC");

      expect(responder).toHaveBeenCalledWith("UTC");
      expect(answer).toBeInstanceOf(Date);
      expect(answer.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      // The question carries its ID, then one wire value.
      expect(contents.send.mock.calls[0]).toStrictEqual([
         "autoipc:askClock",
         expect.any(Number),
         { json: ["UTC"] },
      ]);
   });

   it("rejects with an ask error when the answer cannot be read", async () => {
      const { ipc, mainElectron } = await connect();
      // Contents whose page does not answer by itself, so that the test sends the answer.
      const silent = Object.assign(new EventEmitter(), {
         id: 2,
         getURL: () => "app://.",
         isDestroyed: () => false,
         send: vi.fn(),
      });
      const asked = ipc.askClock.invoke({ webContents: silent }, "UTC");
      const [, id] = silent.send.mock.calls[0];
      const onReply = mainElectron.ipcMain.on.mock.calls.find(
         ([name]: [string]) => name === "autoipc:askClock:reply",
      )?.[1];

      onReply({ sender: silent, senderFrame: null }, id, {
         ok: true,
         value: { json: { $: "Bogus" } },
      });

      await expect(asked).rejects.toMatchObject({
         name: "IpcAskError",
         code: "IPC_ASK_INVALID_REPLY",
      });
   });

   it("rejects the ask with the error when the arguments cannot be serialized, and sends nothing", async () => {
      const { ipc, contents, main } = await connect();

      const asked = ipc.askClock.invoke({ webContents: contents }, () => 1);

      await expect(asked).rejects.toBeInstanceOf(main.IpcSerializationError);
      expect(contents.send).not.toHaveBeenCalled();
   });

   it("answers a question that cannot be read with an error envelope, and runs no responder", async () => {
      const { page, pageElectron } = await connect();
      const responder = vi.fn();
      page.askClock.handle(responder);
      const onAsk = pageElectron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === "autoipc:askClock",
      )?.[1];

      onAsk({}, 9, "raw", "arguments");
      await settle();

      expect(responder).not.toHaveBeenCalled();
      expect(pageElectron.ipcRenderer.send).toHaveBeenCalledWith("autoipc:askClock:reply", 9, {
         ok: false,
         error: expect.objectContaining({
            name: "IpcSerializationError",
            code: "IPC_SERIALIZATION",
         }),
      });
   });

   it("answers with an error when the answer of the responder cannot be serialized", async () => {
      const { page, ipc, contents } = await connect();
      page.askClock.handle(async () => () => 1);

      await expect(ipc.askClock.invoke({ webContents: contents }, "UTC")).rejects.toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
   });
});

describe("generated serializer, stream", () => {
   /** One end of the channel of a call: the main process keeps `port1` and gives `port2` away. */
   function useChannel(mainElectron: { MessageChannelMain: unknown }) {
      const port1 = Object.assign(new EventEmitter(), {
         postMessage: vi.fn(),
         start: vi.fn(),
         close: vi.fn(),
      });
      mainElectron.MessageChannelMain = class {
         port1 = port1;
         port2 = { name: "the end of the page" };
      };
      return port1;
   }

   /** The end of the channel that the page gets, and the call that opens the stream. */
   function openStream(context: Awaited<ReturnType<typeof connect>>, ...args: unknown[]) {
      const { page, pageElectron } = context;
      pageElectron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true, value: undefined });
      const port = {
         onmessage: null as null | ((event: unknown) => void),
         close: vi.fn(),
         addEventListener: vi.fn(),
      };
      const stream = page.history.stream(...args);
      const [, id, wire] = pageElectron.ipcRenderer.invoke.mock.calls[0];
      context.pageListener("autoipc:history:port")({ ports: [port] }, id);
      return { stream, port, wire };
   }

   it("deserializes the arguments of the call and serializes every chunk in the main process", async () => {
      const { ipc, mainElectron, event, spied, handler } = await connect();
      const port1 = useChannel(mainElectron);
      const source = createSource();
      const callback = vi.fn(() => source.iterable);
      ipc.history.handle(callback);

      const reply = await handler("autoipc:history")(event, 3, spied.serialize([new Date(1000)]));
      source.push(appointment());
      await settle();

      expect(reply).toStrictEqual({ ok: true, value: undefined });
      const received = (callback.mock.calls[0] as unknown as [unknown, Date])[1];
      expect(received).toBeInstanceOf(Date);
      expect(received.getTime()).toBe(1000);
      expect(port1.postMessage).toHaveBeenCalledExactlyOnceWith({
         type: "chunk",
         value: spied.serialize(appointment()),
      });
   });

   it("stops the stream with an error when a chunk cannot be serialized", async () => {
      const { ipc, mainElectron, event, spied, handler } = await connect();
      const port1 = useChannel(mainElectron);
      const source = createSource();
      ipc.history.handle(() => source.iterable);

      await handler("autoipc:history")(event, 3, spied.serialize([new Date(0)]));
      source.push({ at: () => 1 });
      await settle();

      expect(source.iterator.return).toHaveBeenCalledOnce();
      expect(port1.postMessage).toHaveBeenCalledExactlyOnceWith({
         type: "error",
         error: expect.objectContaining({ name: "IpcStreamError", code: "IPC_STREAM_UNSENDABLE" }),
      });
   });

   it("answers a call whose arguments cannot be read with an error, and starts no stream", async () => {
      const { ipc, mainElectron, event, handler } = await connect();
      useChannel(mainElectron);
      const callback = vi.fn();
      ipc.history.handle(callback);

      const reply = await handler("autoipc:history")(event, 3, "raw");

      expect(reply).toMatchObject({ ok: false, error: { code: "IPC_SERIALIZATION" } });
      expect(callback).not.toHaveBeenCalled();
   });

   it("sends the arguments serialized and deserializes every chunk in the page", async () => {
      const context = await connect();
      const { stream, port, wire } = openStream(context, new Date(0));

      port.onmessage?.({ data: { type: "chunk", value: context.spied.serialize(appointment()) } });

      expect(wire).toStrictEqual(context.spied.serialize([new Date(0)]));
      await expect(stream.next()).resolves.toStrictEqual({ done: false, value: appointment() });
   });

   it("fails the stream, and closes its port, when a chunk cannot be read", async () => {
      const { stream, port } = openStream(await connect(), new Date(0));

      port.onmessage?.({ data: { type: "chunk", value: { json: { $: "Bogus" } } } });

      await expect(stream.next()).rejects.toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
      expect(port.close).toHaveBeenCalledOnce();
   });

   it("ends the stream with an error, and starts no call, when the arguments cannot be serialized", async () => {
      const { page, pageElectron } = await connect();

      const stream = page.history.stream(() => 1);

      await expect(stream.next()).rejects.toMatchObject({ code: "IPC_SERIALIZATION" });
      expect(pageElectron.ipcRenderer.invoke).not.toHaveBeenCalled();
   });
});

describe("fixture serializer-raw-errors, with rawErrors on", () => {
   it("generates files that type-check", async () => {
      project = await runFixture("serializer-raw-errors");

      expect(await project.typecheck()).toBe("");
   });

   it("serializes the result of the handler itself, since there is no envelope", async () => {
      const { page, ipc, pageElectron } = await connect("serializer-raw-errors");
      ipc.nextDay.handle(
         async (_event: unknown, since: Date) => new Date(since.getTime() + 86_400_000),
      );

      const next = await page.nextDay.invoke(new Date("2026-01-01T00:00:00.000Z"));

      expect(next).toBeInstanceOf(Date);
      expect(next.toISOString()).toBe("2026-01-02T00:00:00.000Z");
      expect(pageElectron.ipcRenderer.invoke.mock.calls[0][0]).toBe("nextDay");
   });

   it("rejects, and does not throw at once, when the arguments cannot be serialized", async () => {
      const { page } = await connect("serializer-raw-errors");

      const promise = page.nextDay.invoke(() => 1);

      await expect(promise).rejects.toMatchObject({ code: "IPC_SERIALIZATION" });
   });

   it("rejects with Electron's error when the handler throws, and registers an async listener", async () => {
      const { page, ipc } = await connect("serializer-raw-errors");
      ipc.nextDay.handle(() => {
         throw new Error("failed");
      });

      await expect(page.nextDay.invoke(new Date(0))).rejects.toThrowError("failed");
   });
});

describe("a schema in which the main process sees no message", () => {
   it("imports the serializer in the preload script only, since the main process just pairs the pages", async () => {
      project = await runFixture("serializer-no-pages");

      expect(project.generated["main.ts"]).not.toContain("serializer");
      expect(project.generated["main.ts"]).not.toContain("ipcSerialize");
      expect(project.generated["preload.ts"]).toContain("ipcSerialize");
      expect(await project.typecheck({ noUnusedLocals: true })).toBe("");
   });
});
