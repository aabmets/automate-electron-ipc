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
import type { E2EProject } from "@testutils/e2e-utils.js";
import { createSource } from "@testutils/runtime-utils.js";
import {
   appointment,
   type Connection,
   serializerConnector,
   settle,
} from "@testutils/serializer-runtime-utils.js";
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
   function openStream(context: Connection, ...args: unknown[]) {
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
