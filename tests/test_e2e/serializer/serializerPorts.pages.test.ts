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

import { createFakePreloadElectron, loadGenerated } from "@testutils/e2e/runtime-utils.js";
import { AT, date, listenerOf, loadSerializer } from "@testutils/e2e/serializer-wire-utils.js";
import { settle, wire } from "@testutils/e2e/wire-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const rawPorts: MessagePort[] = [];

afterEach(() => {
   vi.restoreAllMocks();
   for (const port of rawPorts.splice(0)) {
      port.close();
   }
});

/** A generated preload script of the fixture, with the serializer that it imports. */
async function loadPage() {
   const project = fixtures.current() ?? (await fixtures.run("serializer-ports"));
   const serializer = await loadSerializer(project);
   const fake = createFakePreloadElectron();
   loadGenerated(project.generated["preload.ts"], {
      electron: fake.electron,
      "./serializer": serializer,
   });
   return { fake, ipc: fake.exposed.ipc, serializer };
}

/** Hands a page one end of a real channel, as the main process does, and returns the other end. */
function pair(fake: ReturnType<typeof createFakePreloadElectron>, name: string, key: string) {
   const channel = new MessageChannel();
   rawPorts.push(channel.port1, channel.port2);
   listenerOf(fake, wire(name))({ ports: [channel.port1] }, key);
   return channel.port2;
}

describe("the generated files of a schema with serialized port channels", () => {
   it("type-checks the usage of both sides, with the types of the signatures", async () => {
      const project = await fixtures.run("serializer-ports");

      expect(await project.typecheck()).toBe("");
   });

   it("imports the serializer in the preload script and for the main port, not for the pairing", async () => {
      const project = await fixtures.run("serializer-ports");
      const line =
         'import { serialize as ipcSerialize, deserialize as ipcDeserialize } from "./serializer";';

      expect(project.generated["main.ts"]).toContain(line);
      expect(project.generated["preload.ts"]).toContain(line);
      expect(project.generated["window.d.ts"]).not.toContain("serializ");
      // `tracker` is paired by the main process, which sees none of its messages.
      expect(project.generated["main.ts"]).not.toContain("encodeValue('tracker'");
   });
});

describe("a port channel between two pages, with a serializer", () => {
   async function twoPages() {
      const a = await loadPage();
      const b = await loadPage();
      const channel = new MessageChannel();
      rawPorts.push(channel.port1, channel.port2);
      listenerOf(a.fake, wire("tracker"))({ ports: [channel.port1] }, "1:a");
      listenerOf(b.fake, wire("tracker"))({ ports: [channel.port2] }, "1:b");
      return { a: a.ipc.tracker, b: b.ipc.tracker };
   }

   it("posts the arguments as a list of one serialized value", async () => {
      const { ipc, fake } = await loadPage();
      const peer = pair(fake, "tracker", "1:a");
      const received: unknown[] = [];
      peer.onmessage = (event) => received.push(event.data);

      ipc.tracker.send(new Date(AT), new Set(["a"]));
      await settle();

      expect(received).toStrictEqual([[{ json: [date(AT), { $: "Set", v: ["a"] }] }]]);
   });

   it("delivers a Date and a Set to the other page as they were sent", async () => {
      const { a, b } = await twoPages();
      const received: unknown[][] = [];
      b.on((...args: unknown[]) => received.push(args));

      a.send(new Date(AT), new Set(["x", "y"]));
      await settle();

      expect(received).toHaveLength(1);
      expect(received[0][0]).toBeInstanceOf(Date);
      expect((received[0][0] as Date).toISOString()).toBe(AT);
      expect(received[0][1]).toStrictEqual(new Set(["x", "y"]));
   });

   it("serializes the sends of a connection, and the ones the channel queued before the port", async () => {
      const a = await loadPage();
      const received: unknown[] = [];
      a.ipc.tracker.send(new Date(0), new Set());
      const peer = pair(a.fake, "tracker", "1:a");
      peer.onmessage = (event) => received.push(event.data);
      a.ipc.tracker.send(new Date(1000), new Set(["late"]));
      await settle();

      expect(received).toStrictEqual([
         [{ json: [date("1970-01-01T00:00:00.000Z"), { $: "Set", v: [] }] }],
         [{ json: [date("1970-01-01T00:00:01.000Z"), { $: "Set", v: ["late"] }] }],
      ]);
   });

   it("serializes through the peer of onConnection as well", async () => {
      const a = await loadPage();
      const received: unknown[] = [];
      a.ipc.tracker.onConnection((peer: { send: Function }) => peer.send(new Date(0), new Set()));
      const peer = pair(a.fake, "tracker", "1:a");
      peer.onmessage = (event) => received.push(event.data);
      await settle();

      expect(received).toStrictEqual([
         [{ json: [date("1970-01-01T00:00:00.000Z"), { $: "Set", v: [] }] }],
      ]);
   });

   it("throws the serialization error from a send that cannot be serialized, with the code in the message, and sends nothing", async () => {
      const a = await loadPage();
      const peer = pair(a.fake, "tracker", "1:a");
      const received: unknown[] = [];
      peer.onmessage = (event) => received.push(event.data);

      let thrown: unknown;
      try {
         a.ipc.tracker.send(() => undefined, new Set());
      } catch (error) {
         thrown = error;
      }
      await settle();

      expect(thrown).toStrictEqual({
         name: "IpcSerializationError",
         message:
            "[IPC_SERIALIZATION] The data cannot be serialized of the channel 'tracker': cannot serialize a function",
         code: "IPC_SERIALIZATION",
      });
      expect(received).toStrictEqual([]);
   });

   it("logs a queued message that cannot be serialized, and still flushes the others", async () => {
      const a = await loadPage();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      a.ipc.tracker.send(() => undefined, new Set());
      a.ipc.tracker.send(new Date(0), new Set());

      const peer = pair(a.fake, "tracker", "1:a");
      const received: unknown[] = [];
      peer.onmessage = (event) => received.push(event.data);
      await settle();

      expect(error).toHaveBeenCalledOnce();
      expect(error.mock.calls[0][0]).toMatchObject({ code: "IPC_SERIALIZATION" });
      expect(received).toStrictEqual([
         [{ json: [date("1970-01-01T00:00:00.000Z"), { $: "Set", v: [] }] }],
      ]);
   });

   it("logs and drops a message that cannot be deserialized, and goes on with the next", async () => {
      const a = await loadPage();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const peer = pair(a.fake, "tracker", "1:a");
      const received: unknown[][] = [];
      a.ipc.tracker.on((...args: unknown[]) => received.push(args));

      // An unknown tag, a list of two values, a value that is not a list of arguments and a message
      // that is not a list at all: only the last is ignored without a word.
      peer.postMessage([{ json: { $: "Nope" } }]);
      peer.postMessage([{ json: [] }, { json: [] }]);
      peer.postMessage([{ json: "text" }]);
      peer.postMessage("not a list");
      peer.postMessage([{ json: [date(AT), { $: "Set", v: [] }] }]);
      await settle();

      expect(error).toHaveBeenCalledTimes(3);
      expect(error.mock.calls[0][0]).toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
      expect(received).toHaveLength(1);
      expect((received[0][0] as Date).toISOString()).toBe(AT);
   });

   it("does not tell the subscribers of a message that was dropped", async () => {
      const a = await loadPage();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const peer = pair(a.fake, "tracker", "1:a");
      const own = vi.fn();
      const all = vi.fn();
      a.ipc.tracker.onConnection((connection: { on: Function }) => connection.on(own));
      a.ipc.tracker.on(all);

      peer.postMessage([{ json: { $: "Nope" } }]);
      await settle();

      expect(own).not.toHaveBeenCalled();
      expect(all).not.toHaveBeenCalled();
   });
});
