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
import { appointment, serializerConnector } from "@testutils/e2e/serializer-runtime-utils.js";
import { settle } from "@testutils/e2e/wire-utils.js";
import type { E2EProject } from "@testutils/e2e-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
});

const connect = serializerConnector((created) => {
   project = created;
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
      const onChanged = pageElectron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === "autoipc:changed",
      )?.[1];

      onChanged({}, "garbage");
      ipc.changed.send({ webContents: contents }, appointment());

      expect(listener).toHaveBeenCalledOnce();
   });

   it("reads the message once for any number of subscribers", async () => {
      const { page, ipc, contents, spied, pageElectron } = await connect();
      const listeners = [vi.fn(), vi.fn(), vi.fn()];
      page.changed.on(listeners[0]);
      page.changed.on(listeners[1]);
      page.changed.once(listeners[2]);
      spied.deserialize.mockClear();

      ipc.changed.send({ webContents: contents }, appointment());

      expect(spied.deserialize).toHaveBeenCalledOnce();
      for (const listener of listeners) {
         expect(listener).toHaveBeenCalledOnce();
      }
      // One listener of ipcRenderer for the three subscribers.
      expect(
         pageElectron.ipcRenderer.on.mock.calls.filter(
            ([name]: [string]) => name === "autoipc:changed",
         ),
      ).toHaveLength(1);
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
         isCrashed: () => false,
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
