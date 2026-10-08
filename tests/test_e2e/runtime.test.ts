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

import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import {
   callablePaths,
   createFakeElectron,
   createFakePreloadElectron,
   createFakeWindow,
   loadGenerated,
   windowIpcPaths,
} from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The default `channelPrefix`, which the generated bindings put in front of every wire name. */
const WIRE_PREFIX = "autoipc:";
const wire = (name: string) => `${WIRE_PREFIX}${name}`;

let project: E2EProject | undefined;

afterEach(async () => {
   await project?.cleanup();
   project = undefined;
});

/** Runs the generated preload script against a fake contextBridge and ipcRenderer. */
async function loadPreload(fixture: string) {
   project = await runFixture(fixture);
   const fake = createFakePreloadElectron();
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   return { ...fake, project };
}

describe("fixture all-kinds", () => {
   it("generates files that type-check", async () => {
      project = await runFixture("all-kinds");
      expect(await project.typecheck()).toBe("");
   });
});

describe("generated preload script", () => {
   it.each(["all-kinds", "triggers", "param-shapes", "port-only", "handler-types"])(
      "exposes exactly the members that the generated IpcApi declares (%s)",
      async (fixture) => {
         const { exposed, project } = await loadPreload(fixture);
         expect(Object.keys(exposed)).toStrictEqual(["ipc"]);
         const declared = windowIpcPaths(project.generated["window.d.ts"]);
         expect(declared.length).toBeGreaterThan(0);
         expect(callablePaths(exposed.ipc)).toStrictEqual(declared);
      },
   );

   it("exposes one object per channel, with only the methods of its verb", async () => {
      const { exposed } = await loadPreload("all-kinds");

      expect(callablePaths(exposed.ipc)).toStrictEqual([
         "chat.on",
         "chat.onClose",
         "chat.onReady",
         "chat.send",
         "getTime.invoke",
         "getUser.invoke",
         "logLine.send",
         "progress.on",
         "progress.once",
         "titleChanged.on",
         "titleChanged.once",
      ]);
   });

   it("exposes nothing but an empty api, and declares nothing, when there are no channels", async () => {
      const { exposed, project } = await loadPreload("no-channels");
      expect(callablePaths(exposed.ipc)).toStrictEqual([]);
      expect(windowIpcPaths(project.generated["window.d.ts"])).toStrictEqual([]);
   });

   it("forwards invoke channels to ipcRenderer.invoke and returns its promise", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");
      electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: "Ann" });

      await expect(exposed.ipc.getUser.invoke(7)).resolves.toBe("Ann");
      expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(wire("getUser"), 7);
      await exposed.ipc.getTime.invoke();
      expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith(wire("getTime"));
   });

   it("forwards send channels to ipcRenderer.send, spreading rest arguments", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");

      exposed.ipc.logLine.send("line", 1, 2);

      expect(electron.ipcRenderer.send).toHaveBeenCalledWith(wire("logLine"), "line", 1, 2);
   });

   it("registers listeners which receive the arguments without the event", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");
      const callback = vi.fn();

      exposed.ipc.progress.on(callback);

      const [channel, listener] = electron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === wire("progress"),
      ) as [string, (...args: unknown[]) => void];
      expect(channel).toBe(wire("progress"));
      listener({ sender: "event" }, 50, "half");
      expect(callback).toHaveBeenCalledWith(50, "half");
   });

   it("returns a function which removes only that listener, and not ipcRenderer", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");
      const { ipcRenderer } = electron;
      const first = vi.fn();
      const second = vi.fn();

      const dispose = exposed.ipc.progress.on(first);
      exposed.ipc.progress.on(second);

      expect(typeof dispose).toBe("function");
      expect(dispose).not.toBe(ipcRenderer);
      const listeners = ipcRenderer.on.mock.calls
         .filter(([name]: [string]) => name === wire("progress"))
         .map(([, listener]: [string, (...args: unknown[]) => void]) => listener);
      expect(listeners).toHaveLength(2);

      expect(dispose()).toBeUndefined();
      expect(ipcRenderer.removeListener).toHaveBeenCalledTimes(1);
      expect(ipcRenderer.removeListener).toHaveBeenCalledWith(wire("progress"), listeners[0]);
   });

   it("stops delivering to a disposed listener, as ipcRenderer does after removeListener", async () => {
      // Back the fake with a real emitter, so that the removal is observable.
      const { EventEmitter } = await import("node:events");
      const emitter = new EventEmitter();
      const { exposed, electron } = await loadPreload("all-kinds");
      Object.assign(electron.ipcRenderer, {
         on: emitter.on.bind(emitter),
         once: emitter.once.bind(emitter),
         removeListener: emitter.removeListener.bind(emitter),
      });
      const callback = vi.fn();

      const dispose = exposed.ipc.progress.on(callback);
      emitter.emit(wire("progress"), {}, 1);
      dispose();
      emitter.emit(wire("progress"), {}, 2);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(1);
      expect(emitter.listenerCount(wire("progress"))).toBe(0);
   });

   it("once delivers a single message without the event, and can be disposed before it", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");
      const callback = vi.fn();

      const dispose = exposed.ipc.progress.once(callback);

      const [channel, listener] = electron.ipcRenderer.once.mock.calls[0] as [
         string,
         (...args: unknown[]) => void,
      ];
      expect(channel).toBe(wire("progress"));
      expect(electron.ipcRenderer.on).not.toHaveBeenCalledWith(wire("progress"), expect.anything());
      listener({ sender: "event" }, 5, "x");
      expect(callback).toHaveBeenCalledWith(5, "x");

      dispose();
      expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(wire("progress"), listener);
   });

   it("stores the port of a port channel and posts and receives messages through it", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");
      const port = {
         postMessage: vi.fn(),
         close: vi.fn(),
         addEventListener: vi.fn(),
         onmessage: undefined as ((event: unknown) => void) | undefined,
      };
      const [, onPort] = electron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === wire("chat"),
      ) as [string, (event: unknown) => void];

      onPort({ ports: [port] });
      exposed.ipc.chat.send("hi", 1);
      expect(port.postMessage).toHaveBeenCalledWith(["hi", 1]);

      const callback = vi.fn();
      exposed.ipc.chat.on(callback);
      port.onmessage?.({ data: ["there", 2] });
      expect(callback).toHaveBeenCalledWith("there", 2);
   });
});

describe("generated main process bindings", () => {
   it("exports one object per channel, with only the methods of its verb", async () => {
      project = await runFixture("all-kinds");
      const { ipc } = loadGenerated(project.generated["main.ts"], {
         electron: createFakeElectron(),
      });

      expect(callablePaths(ipc)).toStrictEqual([
         "chat.connect",
         "getTime.handle",
         "getTime.handleOnce",
         "getUser.handle",
         "getUser.handleOnce",
         "logLine.on",
         "logLine.once",
         "progress.broadcast",
         "progress.broadcastTo",
         "progress.send",
         "progress.sendToSender",
         "titleChanged.bind",
         "titleChanged.broadcast",
         "titleChanged.broadcastTo",
         "titleChanged.send",
         "titleChanged.sendToSender",
      ]);
   });

   async function loadMain() {
      project = await runFixture("all-kinds");
      class FakeChannel {
         port1 = { name: "port1" };
         port2 = { name: "port2" };
      }
      const electron = { ...createFakeElectron(), MessageChannelMain: FakeChannel };
      return {
         electron,
         ipc: loadGenerated(project.generated["main.ts"], { electron }).ipc,
      };
   }

   /**
    * Turns the reply of a generated invoke handler into what the renderer sees: the value of an
    * ok envelope, or a rejection carrying `name`, `message`, `code` and `data` of the error.
    */
   function unwrapEnvelope(handler: (...args: unknown[]) => unknown) {
      return async (...args: unknown[]) => {
         const reply = (await handler(...args)) as {
            ok: boolean;
            value?: unknown;
            error?: { name: string; message: string };
         };
         if (reply.ok) {
            return reply.value;
         }
         throw Object.assign(new Error(reply.error?.message), reply.error);
      };
   }

   /** Backs the fake ipcMain with a real emitter, so that registrations are observable. */
   async function loadMainWithEmitter(
      fixture = "all-kinds",
      modules: Record<string, unknown> = {},
   ) {
      const { EventEmitter } = await import("node:events");
      const emitter = new EventEmitter();
      // What the renderer gets: the value of an ok envelope, or a rejection which carries the
      // fields of the error object. `envelopes` holds the replies as the main process sends them.
      const handlers = new Map<string, (...args: unknown[]) => unknown>();
      const envelopes = new Map<string, (...args: unknown[]) => unknown>();
      const electron = createFakeElectron();
      // The tests name channels as the schema does, so the prefix is removed from what Electron gets.
      const bare = (channel: string) => channel.replace(WIRE_PREFIX, "");
      Object.assign(electron.ipcMain, {
         on: (channel: string, listener: (...args: unknown[]) => void) =>
            emitter.on(bare(channel), listener),
         once: (channel: string, listener: (...args: unknown[]) => void) =>
            emitter.once(bare(channel), listener),
         off: (channel: string, listener: (...args: unknown[]) => void) =>
            emitter.off(bare(channel), listener),
         handle: (rawChannel: string, handler: (...args: unknown[]) => unknown) => {
            const channel = bare(rawChannel);
            if (envelopes.has(channel)) {
               throw new Error(`Attempted to register a second handler for '${channel}'`);
            }
            envelopes.set(channel, handler);
            handlers.set(channel, unwrapEnvelope(handler));
         },
         handleOnce: (channel: string, handler: (...args: unknown[]) => unknown) => {
            electron.ipcMain.handle(channel, (...args: unknown[]) => {
               handlers.delete(bare(channel));
               envelopes.delete(bare(channel));
               return handler(...args);
            });
         },
         removeHandler: (rawChannel: string) => {
            handlers.delete(bare(rawChannel));
            envelopes.delete(bare(rawChannel));
         },
      });
      project = await runFixture(fixture);
      const generated = loadGenerated(project.generated["main.ts"], { electron, ...modules });
      return { emitter, handlers, envelopes, ipc: generated.ipc, generated };
   }

   it("registers a handle wrapper which passes the event and arguments to the callback", async () => {
      const { electron, ipc } = await loadMain();
      const callback = vi.fn(async (_event: unknown, id: number) => `user ${id}`);

      ipc.getUser.handle(callback);

      expect(electron.ipcMain.handle).toHaveBeenCalledOnce();
      const [channel, wrapper] = electron.ipcMain.handle.mock.calls[0];
      expect(channel).toBe(wire("getUser"));
      const event = { sender: "renderer" };
      await expect(wrapper(event, 3)).resolves.toStrictEqual({ ok: true, value: "user 3" });
      expect(callback).toHaveBeenCalledWith(event, 3);
      expect(electron.ipcMain.on).not.toHaveBeenCalled();
   });

   it("returns the rejection of the callback to the renderer through handle", async () => {
      const { electron, ipc } = await loadMain();
      ipc.getTime.handle(() => Promise.reject(new Error("no clock")));

      const [, wrapper] = electron.ipcMain.handle.mock.calls[0];
      await expect(wrapper({})).resolves.toStrictEqual({
         ok: false,
         error: { name: "Error", message: "no clock" },
      });
   });

   it("registers an on wrapper which spreads rest arguments", async () => {
      const { electron, ipc } = await loadMain();
      const callback = vi.fn();

      ipc.logLine.on(callback);

      const [channel, wrapper] = electron.ipcMain.on.mock.calls[0];
      expect(channel).toBe(wire("logLine"));
      wrapper("event", "line", 1, 2);
      expect(callback).toHaveBeenCalledWith("event", "line", 1, 2);
   });

   it("returns a function from on which removes only that listener with ipcMain.off", async () => {
      const { electron, ipc } = await loadMain();
      ipc.logLine.on(vi.fn());
      const dispose = ipc.logLine.on(vi.fn());
      const [[, first], [, second]] = electron.ipcMain.on.mock.calls;

      expect(typeof dispose).toBe("function");
      expect(dispose()).toBeUndefined();

      expect(electron.ipcMain.off).toHaveBeenCalledOnce();
      expect(electron.ipcMain.off).toHaveBeenCalledWith(wire("logLine"), second);
      expect(second).not.toBe(first);
   });

   it("stops delivering to a disposed on listener, and to nobody else", async () => {
      const { emitter, ipc } = await loadMainWithEmitter();
      const kept = vi.fn();
      const removed = vi.fn();
      ipc.logLine.on(kept);
      const dispose = ipc.logLine.on(removed);

      emitter.emit("logLine", {}, "a");
      dispose();
      emitter.emit("logLine", {}, "b");

      expect(removed).toHaveBeenCalledTimes(1);
      expect(kept).toHaveBeenCalledTimes(2);
      expect(emitter.listenerCount("logLine")).toBe(1);
   });

   it("once delivers a single message with the event, and can be disposed before it", async () => {
      const { electron, ipc } = await loadMain();
      const callback = vi.fn();

      const dispose = ipc.logLine.once(callback);

      // A normal listener, which removes itself, so that a rejected sender cannot use it up.
      const [channel, wrapper] = electron.ipcMain.on.mock.calls[0];
      expect(channel).toBe(wire("logLine"));
      expect(electron.ipcMain.once).not.toHaveBeenCalled();
      wrapper("event", "line", 1, 2);
      expect(callback).toHaveBeenCalledWith("event", "line", 1, 2);
      expect(electron.ipcMain.off).toHaveBeenCalledWith(wire("logLine"), wrapper);

      electron.ipcMain.off.mockClear();
      dispose();
      expect(electron.ipcMain.off).toHaveBeenCalledWith(wire("logLine"), wrapper);
   });

   it("once delivers to the first message only, with a real emitter", async () => {
      const { emitter, ipc } = await loadMainWithEmitter();
      const callback = vi.fn();
      ipc.logLine.once(callback);

      emitter.emit("logLine", {}, "a");
      emitter.emit("logLine", {}, "b");

      expect(callback).toHaveBeenCalledOnce();
      expect(emitter.listenerCount("logLine")).toBe(0);
   });

   it("replaces the handler of a channel when it is registered again", async () => {
      const { handlers, ipc } = await loadMainWithEmitter();

      ipc.getUser.handle(async () => "old");
      expect(() => ipc.getUser.handle(async () => "new")).not.toThrow();

      expect(handlers.size).toBe(1);
      await expect(handlers.get("getUser")?.({}, 1)).resolves.toBe("new");
   });

   it("calls removeHandler before it registers a handler", async () => {
      const { electron, ipc } = await loadMain();
      const order: string[] = [];
      electron.ipcMain.removeHandler.mockImplementation(() => order.push("remove"));
      electron.ipcMain.handle.mockImplementation(() => order.push("handle"));

      ipc.getUser.handle(async () => "a");
      ipc.getUser.handleOnce(async () => "b");

      expect(order).toStrictEqual(["remove", "handle", "remove", "handle"]);
      expect(electron.ipcMain.handleOnce).not.toHaveBeenCalled();
      expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith(wire("getUser"));
   });

   it("removes the handler through the disposer of handle", async () => {
      const { handlers, ipc } = await loadMainWithEmitter();

      const dispose = ipc.getUser.handle(async () => "user");
      expect(handlers.has("getUser")).toBe(true);

      expect(dispose()).toBeUndefined();
      expect(handlers.has("getUser")).toBe(false);
      // The channel is free again.
      expect(() => ipc.getUser.handle(async () => "again")).not.toThrow();
   });

   it("leaves the replacement alone when the disposer of a replaced handler is called", async () => {
      const { handlers, ipc } = await loadMainWithEmitter();

      const disposeOld = ipc.getUser.handle(async () => "old");
      const disposeNew = ipc.getUser.handle(async () => "new");
      disposeOld();

      await expect(handlers.get("getUser")?.({}, 1)).resolves.toBe("new");
      disposeNew();
      expect(handlers.has("getUser")).toBe(false);
      // A disposer which is called twice does not remove a later handler either.
      ipc.getUser.handle(async () => "later");
      disposeNew();
      expect(handlers.has("getUser")).toBe(true);
   });

   it("handleOnce answers one invoke with the event and arguments, then the channel is free", async () => {
      const { handlers, ipc } = await loadMainWithEmitter();
      const callback = vi.fn(async (_event: unknown, id: number) => `user ${id}`);

      ipc.getUser.handleOnce(callback);
      const event = { sender: "renderer" };

      await expect(handlers.get("getUser")?.(event, 7)).resolves.toBe("user 7");
      expect(callback).toHaveBeenCalledWith(event, 7);
      expect(handlers.has("getUser")).toBe(false);
   });

   it("handleOnce replaces an earlier handler, and its disposer works before the invoke", async () => {
      const { handlers, ipc } = await loadMainWithEmitter();
      ipc.getUser.handle(async () => "old");

      const dispose = ipc.getUser.handleOnce(async () => "once");
      await expect(handlers.get("getUser")?.({}, 1)).resolves.toBe("once");

      const disposeAgain = ipc.getUser.handleOnce(async () => "again");
      expect(handlers.has("getUser")).toBe(true);
      disposeAgain();
      expect(handlers.has("getUser")).toBe(false);
      dispose();
      expect(handlers.has("getUser")).toBe(false);
   });

   it("posts the two ends of a port channel to the two windows once they have loaded", async () => {
      const { ipc } = await loadMain();
      const loaded = () =>
         Object.assign(createFakeWindow(), {
            webContents: {
               postMessage: vi.fn(),
               send: vi.fn(),
               on: vi.fn(),
               off: vi.fn(),
               isLoading: () => false,
               getURL: () => "app://.",
            },
         });
      const one = loaded();
      const two = loaded();

      ipc.chat.connect(one, two);

      expect(one.webContents.postMessage).toHaveBeenCalledWith(wire("chat"), null, [
         { name: "port1" },
      ]);
      expect(two.webContents.postMessage).toHaveBeenCalledWith(wire("chat"), null, [
         { name: "port2" },
      ]);
   });

   describe("sender validation", () => {
      const frame = (origin: unknown) => ({ senderFrame: { origin, url: `${origin}/index.html` } });
      const load = () => loadMainWithEmitter("sender-validation");
      const secret = (
         handlers: Map<string, (...args: unknown[]) => unknown>,
         event: unknown,
         id = 1,
      ) => handlers.get("getSecret")?.(event, id);

      it("exports configureIpc and IpcForbiddenError only when there are renderer-to-main channels", async () => {
         const { generated } = await load();
         expect(typeof generated.configureIpc).toBe("function");
         expect(new generated.IpcForbiddenError("x")).toBeInstanceOf(Error);

         project = await runFixture("port-only");
         expect(project.generated["main.ts"]).not.toContain("configureIpc");
         await project.cleanup();
         project = undefined;
      });

      it("describes the rejected channel in an IpcForbiddenError", async () => {
         const { generated } = await load();
         const error = new generated.IpcForbiddenError("getSecret");

         expect(error.name).toBe("IpcForbiddenError");
         expect(error.channel).toBe("getSecret");
         expect(error.message).toContain("'getSecret'");
      });

      it("checks nothing when no validator and no origins apply", async () => {
         const { emitter, handlers, ipc } = await load();
         const callback = vi.fn();
         ipc.getPublic.handle(async () => 7);
         ipc.ping.on(callback);

         // Not even a frame: nothing is configured for these channels.
         await expect(handlers.get("getPublic")?.({})).resolves.toBe(7);
         emitter.emit("ping", { senderFrame: null });
         expect(callback).toHaveBeenCalledOnce();
      });

      it.each(["app://.", "http://localhost:5173"])(
         "lets the allowed origin %s call an invoke channel",
         async (origin) => {
            const { handlers, ipc } = await load();
            const callback = vi.fn(async (_event: unknown, id: number) => `secret ${id}`);
            ipc.getSecret.handle(callback);

            const event = frame(origin);
            await expect(secret(handlers, event, 4)).resolves.toBe("secret 4");
            expect(callback).toHaveBeenCalledWith(event, 4);
         },
      );

      it("rejects a call from another origin with an IpcForbiddenError and does not run the handler", async () => {
         const { generated, handlers, ipc } = await load();
         const callback = vi.fn(async () => "secret");
         ipc.getSecret.handle(callback);

         await expect(secret(handlers, frame("https://example.com"))).rejects.toMatchObject({
            name: "IpcForbiddenError",
            code: "IPC_FORBIDDEN",
            message: expect.stringContaining("'getSecret'"),
         });
         expect(generated.IpcForbiddenError).toBeTypeOf("function");
         expect(callback).not.toHaveBeenCalled();
      });

      it("drops a send from another origin and delivers one from an allowed origin", async () => {
         const { emitter, ipc } = await load();
         const callback = vi.fn();
         ipc.logLine.on(callback);

         expect(() => emitter.emit("logLine", frame("https://example.com"), "bad")).not.toThrow();
         emitter.emit("logLine", frame("app://."), "good");

         expect(callback).toHaveBeenCalledOnce();
         expect(callback).toHaveBeenCalledWith(expect.anything(), "good");
      });

      it("allows only the origins of its own channel", async () => {
         const { emitter, ipc } = await load();
         const callback = vi.fn();
         ipc.logLine.on(callback);

         // `http://localhost:5173` may call getSecret but not logLine.
         emitter.emit("logLine", frame("http://localhost:5173"), "text");

         expect(callback).not.toHaveBeenCalled();
      });

      it("rejects a null sender frame, a missing one and a frame without a string origin", async () => {
         const { emitter, handlers, ipc } = await load();
         const callback = vi.fn();
         ipc.logLine.on(callback);
         ipc.getSecret.handle(async () => "secret");

         for (const event of [
            { senderFrame: null },
            {},
            frame(undefined),
            frame(null),
            frame(5173),
            frame(["app://."]),
         ]) {
            emitter.emit("logLine", event, "text");
            // biome-ignore lint/performance/noAwaitInLoops: the cases are checked in order
            await expect(secret(handlers, event)).rejects.toThrowError(/not allowed/);
         }
         expect(callback).not.toHaveBeenCalled();
      });

      it.each([
         "app://.attacker.com",
         "app://./",
         "app://",
         "http://localhost:5173.attacker.com",
         "http://localhost:51730",
         "http://localhost:5173/",
         "http://localhost",
         "https://localhost:5173",
         "http://example.com.attacker.com",
         "http://example.com#http://localhost:5173",
         "HTTP://LOCALHOST:5173",
         " app://.",
         "",
      ])(
         "rejects the lookalike origin '%s', since origins are compared for equality",
         async (origin) => {
            const { handlers, ipc } = await load();
            ipc.getSecret.handle(async () => "secret");

            await expect(secret(handlers, frame(origin))).rejects.toThrowError(/not allowed/);
         },
      );

      it("reads the sender frame before the handler runs, since it can become null", async () => {
         const { handlers, ipc } = await load();
         let reads = 0;
         const event = {
            get senderFrame() {
               reads += 1;
               // Detached after the first read, as Electron does for a frame which is gone.
               return reads === 1 ? { origin: "app://." } : null;
            },
         };
         const callback = vi.fn(async () => {
            await Promise.resolve();
            return "secret";
         });
         ipc.getSecret.handle(callback);

         await expect(secret(handlers, event)).resolves.toBe("secret");
         expect(reads).toBe(1);
      });

      it("runs the global validator with the event and the channel name, for every channel", async () => {
         const { generated, emitter, handlers, ipc } = await load();
         const validateSender = vi.fn(() => true);
         generated.configureIpc({ validateSender });
         const callback = vi.fn();
         ipc.ping.on(callback);
         ipc.getPublic.handle(async () => 7);

         const event = frame("app://.");
         emitter.emit("ping", event);
         await handlers.get("getPublic")?.(event);

         expect(validateSender).toHaveBeenCalledWith(event, "ping");
         expect(validateSender).toHaveBeenCalledWith(event, "getPublic");
         expect(callback).toHaveBeenCalledOnce();
      });

      it("rejects when the global validator says no, even for an allowed origin", async () => {
         const { generated, handlers, ipc } = await load();
         generated.configureIpc({ validateSender: () => false });
         ipc.getSecret.handle(async () => "secret");
         ipc.getPublic.handle(async () => 7);

         await expect(secret(handlers, frame("app://."))).rejects.toThrowError(/not allowed/);
         await expect(handlers.get("getPublic")?.(frame("app://."))).rejects.toThrowError(
            /not allowed/,
         );
      });

      it("rejects an origin which the channel does not allow, even when the global validator says yes", async () => {
         const { generated, handlers, ipc } = await load();
         generated.configureIpc({ validateSender: () => true });
         ipc.getSecret.handle(async () => "secret");

         await expect(secret(handlers, frame("https://example.com"))).rejects.toThrowError(
            /not allowed/,
         );
         await expect(secret(handlers, frame("app://."))).resolves.toBe("secret");
      });

      it("rejects a null frame when only the global validator applies", async () => {
         const { generated, handlers, ipc } = await load();
         const validateSender = vi.fn(() => true);
         generated.configureIpc({ validateSender });
         ipc.getPublic.handle(async () => 7);

         await expect(handlers.get("getPublic")?.({ senderFrame: null })).rejects.toThrowError(
            /not allowed/,
         );
         expect(validateSender).not.toHaveBeenCalled();
      });

      it("rejects when the global validator throws or returns a value which is not true", async () => {
         const { generated, handlers, ipc } = await load();
         ipc.getPublic.handle(async () => 7);

         for (const validateSender of [
            () => {
               throw new Error("broken");
            },
            () => "yes",
            () => 1,
            () => undefined,
         ]) {
            generated.configureIpc({ validateSender });
            // biome-ignore lint/performance/noAwaitInLoops: each case replaces the validator
            await expect(handlers.get("getPublic")?.(frame("app://."))).rejects.toThrowError(
               /not allowed/,
            );
         }
      });

      it("calls onRejected for each rejected call, with the event and the channel, and never for an allowed one", async () => {
         const { generated, emitter, handlers, ipc } = await load();
         const onRejected = vi.fn();
         generated.configureIpc({ onRejected });
         ipc.getSecret.handle(async () => "secret");
         ipc.logLine.on(vi.fn());

         const bad = frame("https://example.com");
         await expect(secret(handlers, bad)).rejects.toThrowError(/not allowed/);
         emitter.emit("logLine", bad, "text");
         await secret(handlers, frame("app://."));
         emitter.emit("logLine", frame("app://."), "text");

         expect(onRejected.mock.calls).toStrictEqual([
            [bad, "getSecret"],
            [bad, "logLine"],
         ]);
      });

      it("rejects as usual when onRejected throws", async () => {
         const { generated, emitter, handlers, ipc } = await load();
         generated.configureIpc({
            onRejected: () => {
               throw new Error("hook failed");
            },
         });
         const callback = vi.fn();
         ipc.getSecret.handle(async () => "secret");
         ipc.logLine.on(callback);

         await expect(secret(handlers, frame("https://example.com"))).rejects.toThrowError(
            /not allowed/,
         );
         expect(() => emitter.emit("logLine", frame("https://example.com"), "x")).not.toThrow();
         expect(callback).not.toHaveBeenCalled();
      });

      it("replaces the whole configuration on each configureIpc call", async () => {
         const { generated, handlers, ipc } = await load();
         ipc.getPublic.handle(async () => 7);
         generated.configureIpc({ validateSender: () => false });
         await expect(handlers.get("getPublic")?.(frame("app://."))).rejects.toThrowError(
            /not allowed/,
         );

         generated.configureIpc({});

         await expect(handlers.get("getPublic")?.({})).resolves.toBe(7);
      });

      it("does not use up handleOnce or once with a rejected sender", async () => {
         const { emitter, handlers, ipc } = await load();
         const answer = vi.fn(async () => "secret");
         const heard = vi.fn();
         ipc.getSecret.handleOnce(answer);
         ipc.logLine.once(heard);
         const bad = frame("https://example.com");

         await expect(secret(handlers, bad)).rejects.toThrowError(/not allowed/);
         emitter.emit("logLine", bad, "x");
         expect(handlers.has("getSecret")).toBe(true);
         expect(emitter.listenerCount("logLine")).toBe(1);

         await expect(secret(handlers, frame("app://."))).resolves.toBe("secret");
         emitter.emit("logLine", frame("app://."), "y");
         emitter.emit("logLine", frame("app://."), "z");

         expect(answer).toHaveBeenCalledOnce();
         expect(handlers.has("getSecret")).toBe(false);
         expect(heard).toHaveBeenCalledOnce();
         expect(emitter.listenerCount("logLine")).toBe(0);
      });

      it("generates files that type-check", async () => {
         project = await runFixture("sender-validation");
         expect(await project.typecheck()).toBe("");
      });
   });

   describe("argument validation", () => {
      type Validate = (value: unknown) => unknown;
      /** A hand-written Standard Schema, which records what it was asked to validate. */
      const schema = (validate: Validate) => {
         const wrapped = vi.fn(validate);
         return {
            "~standard": { version: 1, vendor: "test", validate: wrapped },
            validate: wrapped,
         };
      };
      const ok = (value: unknown) => ({ value });
      const fail = (message: string) => ({ issues: [{ message }] });
      const isNumber = (value: unknown) =>
         Array.isArray(value) && value.length === 1 && typeof value[0] === "number"
            ? ok(value)
            : fail("expected one number");

      async function load(overrides: { id?: Validate; line?: Validate; none?: Validate } = {}) {
         const id = schema(overrides.id ?? isNumber);
         const line = schema(overrides.line ?? ok);
         const none = schema(overrides.none ?? ok);
         const loaded = await loadMainWithEmitter("argument-validation", {
            "./validators": { __esModule: true, default: none, idArgs: id, lineArgs: line },
         });
         return { ...loaded, id, line, none };
      }
      const inApp = { senderFrame: { origin: "app://." } };
      const call = (handlers: Map<string, (...args: unknown[]) => unknown>, ...args: unknown[]) =>
         handlers.get("getCount")?.({}, ...args);

      it("exports IpcValidationError only when a channel has a validator", async () => {
         const { generated } = await load();
         const error = new generated.IpcValidationError("getCount", [{ message: "bad" }]);
         expect(error).toBeInstanceOf(Error);
         expect(error.name).toBe("IpcValidationError");
         expect(error.channel).toBe("getCount");
         expect(error.issues).toStrictEqual([{ message: "bad" }]);
         expect(error.message).toBe("The arguments of the channel 'getCount' are invalid: bad");
         await project?.cleanup();

         project = await runFixture("sender-validation");
         expect(project.generated["main.ts"]).not.toContain("IpcValidationError");
      });

      it("runs the handler with the validated arguments when the schema accepts", async () => {
         const { handlers, ipc, id } = await load();
         const callback = vi.fn((_event: unknown, value: number) => value + 1);
         ipc.getCount.handle(callback);

         await expect(call(handlers, 4)).resolves.toBe(5);
         expect(id.validate).toHaveBeenCalledWith([4]);
         expect(callback).toHaveBeenCalledWith({}, 4);
      });

      it("passes the arguments exactly as they arrived, so a schema sees extra ones", async () => {
         const { handlers, ipc, id } = await load();
         ipc.getCount.handle(vi.fn());

         await expect(call(handlers, 4, "extra")).rejects.toThrowError(/expected one number/);
         await expect(call(handlers)).rejects.toThrowError(/expected one number/);
         expect(id.validate.mock.calls).toStrictEqual([[[4, "extra"]], [[]]]);
      });

      it("gives the handler the output of the schema, not the input", async () => {
         const { handlers, ipc } = await load({
            id: (value) => ok([Number((value as unknown[])[0]) * 2]),
         });
         const callback = vi.fn();
         ipc.getCount.handle(callback);

         await call(handlers, "21");

         expect(callback).toHaveBeenCalledWith({}, 42);
      });

      it("rejects an invoke with an IpcValidationError that carries the issues", async () => {
         const { generated, handlers, ipc } = await load({
            id: () => ({ issues: [{ message: "bad id", path: ["0"] }, { message: "again" }] }),
         });
         const callback = vi.fn();
         ipc.getCount.handle(callback);

         const error = await call(handlers, "x").catch((thrown: unknown) => thrown);

         expect(generated.IpcValidationError).toBeTypeOf("function");
         expect(error).toMatchObject({
            name: "IpcValidationError",
            code: "IPC_VALIDATION",
            data: [{ message: "bad id", path: ["0"] }, { message: "again" }],
         });
         expect((error as Error).message).toContain("bad id; again");
         expect(callback).not.toHaveBeenCalled();
      });

      it("sends the paths of the issues as plain strings and numbers, which can be cloned", async () => {
         const symbol = Symbol("secret");
         const { handlers, ipc } = await load({
            id: () => ({
               issues: [{ message: "bad", path: [symbol, { key: 2 }, { key: symbol }, "name"] }],
            }),
         });
         ipc.getCount.handle(vi.fn());

         const error = await call(handlers, "x").catch((thrown: unknown) => thrown);

         expect((error as { data: unknown }).data).toStrictEqual([
            { message: "bad", path: ["Symbol(secret)", 2, "Symbol(secret)", "name"] },
         ]);
         expect(() => structuredClone((error as { data: unknown }).data)).not.toThrow();
      });

      it("drops an invalid send, and delivers a valid one with its rest arguments", async () => {
         const { emitter, ipc, line } = await load({
            line: (value) =>
               typeof (value as unknown[])[0] === "string" ? ok(value) : fail("text"),
         });
         const callback = vi.fn();
         ipc.logLine.on(callback);

         expect(() => emitter.emit("logLine", {}, 5)).not.toThrow();
         emitter.emit("logLine", {}, "ok", 1, 2);

         expect(callback).toHaveBeenCalledOnce();
         expect(callback).toHaveBeenCalledWith({}, "ok", 1, 2);
         expect(line.validate).toHaveBeenCalledWith(["ok", 1, 2]);
      });

      it("accepts a default import as the validator", async () => {
         const { emitter, ipc, none } = await load({
            none: (value) => ((value as unknown[]).length === 0 ? ok(value) : fail("none")),
         });
         const callback = vi.fn();
         ipc.ping.on(callback);

         emitter.emit("ping", {}, "extra");
         emitter.emit("ping", {});

         expect(none.validate).toHaveBeenCalledTimes(2);
         expect(callback).toHaveBeenCalledOnce();
      });

      it("awaits an asynchronous schema before it runs the handler", async () => {
         const { handlers, ipc } = await load({ id: async (value) => isNumber(value) });
         const callback = vi.fn(async (_event: unknown, value: number) => value * 3);
         ipc.getCount.handle(callback);

         const answer = call(handlers, 2) as Promise<number>;
         expect(callback).not.toHaveBeenCalled();
         await expect(answer).resolves.toBe(6);
         await expect(call(handlers, "2")).rejects.toThrowError(/expected one number/);
         expect(callback).toHaveBeenCalledOnce();
      });

      it("drops an invalid send of an asynchronous schema without an unhandled rejection", async () => {
         const { emitter, ipc } = await load({ line: async () => fail("late") });
         const callback = vi.fn();
         const unhandled = vi.fn();
         process.on("unhandledRejection", unhandled);
         try {
            ipc.logLine.on(callback);
            emitter.emit("logLine", {}, "x");
            await new Promise((resolve) => setTimeout(resolve, 5));
         } finally {
            process.off("unhandledRejection", unhandled);
         }
         expect(callback).not.toHaveBeenCalled();
         expect(unhandled).not.toHaveBeenCalled();
      });

      it.each([
         [
            "throws",
            () => {
               throw new Error("secret internals");
            },
         ],
         ["rejects", () => Promise.reject(new Error("secret internals"))],
      ])("rejects when the schema %s, without passing on its message", async (_name, validate) => {
         const { generated, handlers, ipc } = await load({ id: validate });
         const callback = vi.fn();
         ipc.getCount.handle(callback);

         const result = await call(handlers, 1).catch((error: unknown) => error);

         expect(generated.IpcValidationError).toBeTypeOf("function");
         expect(result).toMatchObject({ name: "IpcValidationError" });
         expect(String((result as Error).message)).not.toContain("secret");
         expect(callback).not.toHaveBeenCalled();
      });

      it.each([
         ["a result without an array", () => ok("not an array")],
         ["no result", () => undefined],
         ["a null result", () => null],
      ])("rejects when the schema answers with %s", async (_name, validate) => {
         const { handlers, ipc } = await load({ id: validate });
         const callback = vi.fn();
         ipc.getCount.handle(callback);

         await expect(call(handlers, 1)).rejects.toThrowError(/invalid/);
         expect(callback).not.toHaveBeenCalled();
      });

      it("checks the sender before the schema sees the arguments", async () => {
         const { generated, handlers, ipc, id } = await load();
         ipc.getSecret.handle(vi.fn());

         await expect(
            handlers.get("getSecret")?.({ senderFrame: { origin: "https://evil" } }, 1),
         ).rejects.toMatchObject({ name: "IpcForbiddenError" });
         expect(generated.IpcForbiddenError).toBeTypeOf("function");
         expect(id.validate).not.toHaveBeenCalled();
         await expect(handlers.get("getSecret")?.(inApp, "bad")).rejects.toMatchObject({
            name: "IpcValidationError",
         });
      });

      it("reports each rejection to onRejected, with the reason, and never an accepted call", async () => {
         const { generated, handlers, emitter, ipc } = await load({
            line: () => fail("no good"),
         });
         const onRejected = vi.fn();
         generated.configureIpc({ onRejected });
         ipc.getCount.handle(vi.fn());
         ipc.logLine.on(vi.fn());

         await call(handlers, 1);
         expect(onRejected).not.toHaveBeenCalled();
         await expect(call(handlers, "bad")).rejects.toThrowError();
         emitter.emit("logLine", { id: "evt" }, "x");

         expect(onRejected).toHaveBeenCalledTimes(2);
         const [event, channel, error] = onRejected.mock.calls[1];
         expect(event).toStrictEqual({ id: "evt" });
         // Hooks get the name from the schema, not the name on the wire.
         expect(channel).toBe("logLine");
         expect(error).toBeInstanceOf(generated.IpcValidationError);
         expect(error.issues).toStrictEqual([{ message: "no good" }]);
         expect(onRejected.mock.calls[0][2]).toBeInstanceOf(generated.IpcValidationError);
      });

      it("passes an IpcForbiddenError to onRejected when the sender is refused", async () => {
         const { generated, handlers, ipc } = await load();
         const onRejected = vi.fn();
         generated.configureIpc({ onRejected });
         ipc.getSecret.handle(vi.fn());

         await expect(handlers.get("getSecret")?.({ senderFrame: null }, 1)).rejects.toThrowError();

         expect(onRejected.mock.calls[0][2]).toBeInstanceOf(generated.IpcForbiddenError);
      });

      it("rejects as usual when onRejected throws", async () => {
         const { generated, handlers, emitter, ipc } = await load({ line: () => fail("x") });
         generated.configureIpc({
            onRejected: () => {
               throw new Error("hook failed");
            },
         });
         const callback = vi.fn();
         ipc.getCount.handle(callback);
         ipc.logLine.on(callback);

         await expect(call(handlers, "bad")).rejects.toMatchObject({ name: "IpcValidationError" });
         expect(generated.IpcValidationError).toBeTypeOf("function");
         expect(() => emitter.emit("logLine", {}, "x")).not.toThrow();
         expect(callback).not.toHaveBeenCalled();
      });

      it("does not validate channels without a validator", async () => {
         const { handlers, ipc, id, line, none } = await load();
         ipc.getPublic.handle(async () => 7);

         await expect(handlers.get("getPublic")?.({}, "anything")).resolves.toBe(7);
         for (const validator of [id, line, none]) {
            expect(validator.validate).not.toHaveBeenCalled();
         }
      });

      it("does not use up once or handleOnce with an invalid message", async () => {
         const { emitter, handlers, ipc } = await load({
            id: isNumber,
            line: (value) => (typeof (value as unknown[])[0] === "string" ? ok(value) : fail("x")),
         });
         const answer = vi.fn(() => "done");
         const heard = vi.fn();
         ipc.getCount.handleOnce(answer);
         ipc.logLine.once(heard);

         await expect(call(handlers, "bad")).rejects.toThrowError(/invalid/);
         emitter.emit("logLine", {}, 5);
         expect(handlers.has("getCount")).toBe(true);
         expect(emitter.listenerCount("logLine")).toBe(1);

         await expect(call(handlers, 1)).resolves.toBe("done");
         emitter.emit("logLine", {}, "y");
         emitter.emit("logLine", {}, "z");

         expect(answer).toHaveBeenCalledOnce();
         expect(handlers.has("getCount")).toBe(false);
         expect(heard).toHaveBeenCalledOnce();
         expect(emitter.listenerCount("logLine")).toBe(0);
      });

      it("gives once and handleOnce to one message only, even with an asynchronous schema", async () => {
         const { emitter, handlers, ipc } = await load({
            id: async (value) => isNumber(value),
            line: async (value) => ok(value),
         });
         const answer = vi.fn(() => "done");
         const heard = vi.fn();
         ipc.getCount.handleOnce(answer);
         ipc.logLine.once(heard);

         // Both messages are in flight before either one is accepted.
         const first = call(handlers, 1) as Promise<string>;
         const second = call(handlers, 2) as Promise<string>;
         emitter.emit("logLine", {}, "a");
         emitter.emit("logLine", {}, "b");

         await expect(first).resolves.toBe("done");
         await expect(second).rejects.toThrowError("No handler registered for 'getCount'");
         await new Promise((resolve) => setTimeout(resolve, 5));
         expect(answer).toHaveBeenCalledOnce();
         expect(heard).toHaveBeenCalledOnce();
         expect(heard).toHaveBeenCalledWith({}, "a");
      });

      it("generates files that type-check", async () => {
         project = await runFixture("argument-validation");
         expect(await project.typecheck()).toBe("");
      });
   });
});
