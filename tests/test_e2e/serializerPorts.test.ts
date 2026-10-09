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
   finishLoading,
   loadGenerated,
} from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const wire = (name: string) => `autoipc:${name}`;
const closeWire = (name: string) => `autoipc:${name}:close`;

let project: E2EProject | undefined;
const rawPorts: MessagePort[] = [];

afterEach(async () => {
   vi.restoreAllMocks();
   for (const port of rawPorts.splice(0)) {
      port.close();
   }
   await project?.cleanup();
   project = undefined;
});

/** Lets the messages and the events of the real ports arrive. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

/** What `Date`, `Set` and `Map` look like on the wire, in the serializer of the fixture. */
const date = (iso: string) => ({ $: "Date", v: iso });
const AT = "2026-10-09T10:00:00.000Z";

/** The serializer module of the fixture, which the generated files import. */
async function loadSerializer() {
   const text = await fsp.readFile(path.join(project?.dir ?? "", "ipc", "serializer.ts"), "utf8");
   return loadGenerated(text, {});
}

/** The listener that a generated preload script registered on a wire channel. */
function listenerOf(fake: ReturnType<typeof createFakePreloadElectron>, name: string) {
   const call = fake.electron.ipcRenderer.on.mock.calls.find(
      ([channel]: [string]) => channel === name,
   );
   return call?.[1] as (...args: unknown[]) => void;
}

/** A generated preload script of the fixture, with the serializer that it imports. */
async function loadPage() {
   project ??= await runFixture("serializer-ports");
   const serializer = await loadSerializer();
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
      project = await runFixture("serializer-ports");

      expect(await project.typecheck()).toBe("");
   });

   it("imports the serializer in the preload script and for the main port, not for the pairing", async () => {
      project = await runFixture("serializer-ports");
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

   it("throws the plain serialization error from a send that cannot be serialized, and sends nothing", async () => {
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
            "The data cannot be serialized of the channel 'tracker': cannot serialize a function",
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

/** The ports a `MessageChannelMain` made, in order, with what the main process posted to each. */
const posted: unknown[] = [];

/**
 * A `MessagePortMain` over a real `MessagePort`: Electron's port reports `{ data }` to `message`
 * listeners and has `start()`, which this one maps to the web API.
 */
class RealPortMain extends EventEmitter {
   private readonly raw: MessagePort;
   constructor(raw: MessagePort) {
      super();
      this.raw = raw;
      raw.addEventListener("message", (event) => this.emit("message", { data: event.data }));
      raw.addEventListener("close", () => this.emit("close"));
      rawPorts.push(raw);
   }
   start() {
      this.raw.start();
   }
   postMessage(message: unknown) {
      posted.push(message);
      this.raw.postMessage(message);
   }
   close() {
      this.raw.close();
   }
}

class RealChannelMain {
   port1: RealPortMain;
   port2: MessagePort;
   constructor() {
      const channel = new MessageChannel();
      this.port1 = new RealPortMain(channel.port1);
      this.port2 = channel.port2;
      rawPorts.push(channel.port2);
   }
}

function createContents(state: { loading?: boolean } = {}) {
   const contents = Object.assign(new EventEmitter(), {
      loading: state.loading ?? false,
      postMessage: vi.fn(),
      send: vi.fn(),
      isLoading: () => contents.loading,
      getURL: () => "app://.",
      isDestroyed: () => false,
   });
   return contents;
}

/** The generated main process and preload script of the fixture, wired to each other for one page. */
async function loadBoth(loading = false) {
   project = await runFixture("serializer-ports");
   const serializer = await loadSerializer();
   posted.length = 0;
   const electron = { ...createFakeElectron(), MessageChannelMain: RealChannelMain };
   const main = loadGenerated(project.generated["main.ts"], {
      electron,
      "./serializer": serializer,
   });
   const fake = createFakePreloadElectron();
   loadGenerated(project.generated["preload.ts"], {
      electron: fake.electron,
      "./serializer": serializer,
   });
   const contents = createContents({ loading });
   /** The ports that the page was given, which the page holds and the test can write to as well. */
   const pagePorts: MessagePort[] = [];
   contents.postMessage.mockImplementation((channel: string, key: string, ports: MessagePort[]) => {
      pagePorts.push(...ports);
      listenerOf(fake, channel)({ ports }, key);
   });
   contents.send.mockImplementation((channel: string, key: string) =>
      listenerOf(fake, channel)({}, key),
   );
   return { main, ipc: main.ipc, contents, page: fake.exposed.ipc.feed, fake, pagePorts };
}

describe("a main process and a page over a port channel, with a serializer", () => {
   it("delivers a Date and a Map in both directions", async () => {
      const { ipc, contents, page } = await loadBoth();
      const connection = ipc.feed.connect(contents);
      const fromMain: unknown[][] = [];
      const fromPage: unknown[][] = [];
      page.on((...args: unknown[]) => fromMain.push(args));
      connection.on((...args: unknown[]) => fromPage.push(args));

      connection.send(new Date(AT), new Map([["ada", 2]]));
      page.send(new Date(0), new Map([["grace", 3]]));
      await settle();

      expect((fromMain[0][0] as Date).toISOString()).toBe(AT);
      expect(fromMain[0][1]).toStrictEqual(new Map([["ada", 2]]));
      expect((fromPage[0][0] as Date).getTime()).toBe(0);
      expect(fromPage[0][1]).toStrictEqual(new Map([["grace", 3]]));
   });

   it("posts the arguments as a list of one serialized value", async () => {
      const { ipc, contents } = await loadBoth();
      const connection = ipc.feed.connect(contents);

      connection.send(new Date(AT), new Map([["ada", 2]]));

      expect(posted).toStrictEqual([[{ json: [date(AT), { $: "Map", v: [["ada", 2]] }] }]]);
   });

   it("serializes the messages that waited for the page when it has loaded", async () => {
      const { ipc, contents, page } = await loadBoth(true);
      const connection = ipc.feed.connect(contents);
      const fromMain: unknown[][] = [];
      page.on((...args: unknown[]) => fromMain.push(args));

      connection.send(new Date(0), new Map());
      connection.send(new Date(1000), new Map([["a", 1]]));
      expect(posted).toStrictEqual([]);
      finishLoading(contents);
      await settle();

      expect(fromMain.map(([at]) => (at as Date).getTime())).toStrictEqual([0, 1000]);
   });

   it("throws an IpcSerializationError from a send that cannot be serialized, and posts nothing", async () => {
      const { main, ipc, contents } = await loadBoth();
      const connection = ipc.feed.connect(contents);

      let thrown: unknown;
      try {
         connection.send(() => undefined, new Map());
      } catch (error) {
         thrown = error;
      }

      expect(thrown).toBeInstanceOf(main.IpcSerializationError);
      expect(thrown).toMatchObject({ code: "IPC_SERIALIZATION", channel: "feed" });
      expect(posted).toStrictEqual([]);
   });

   it("logs a queued message that cannot be serialized, and still flushes the others", async () => {
      const { ipc, contents, page } = await loadBoth(true);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const connection = ipc.feed.connect(contents);
      const fromMain: unknown[][] = [];
      page.on((...args: unknown[]) => fromMain.push(args));

      connection.send(() => undefined, new Map());
      connection.send(new Date(5000), new Map());
      finishLoading(contents);
      await settle();

      expect(error).toHaveBeenCalledOnce();
      expect(error.mock.calls[0][0]).toMatchObject({ code: "IPC_SERIALIZATION" });
      expect(fromMain.map(([at]) => (at as Date).getTime())).toStrictEqual([5000]);
   });

   it("logs and drops a message of the page that cannot be deserialized", async () => {
      const { ipc, contents, page, pagePorts } = await loadBoth();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const connection = ipc.feed.connect(contents);
      const fromPage: unknown[][] = [];
      connection.on((...args: unknown[]) => fromPage.push(args));

      page.send(new Date(0), new Map());
      await settle();
      expect(fromPage).toHaveLength(1);
      expect(error).not.toHaveBeenCalled();

      // A message from a page that was built without the serializer: its arguments as they are.
      pagePorts[0].postMessage(["plain", 1]);
      await settle();

      expect(error).toHaveBeenCalledOnce();
      expect(error.mock.calls[0][0]).toMatchObject({
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
      expect(fromPage).toHaveLength(1);
   });

   it("closes with the page as before", async () => {
      const { ipc, contents, fake } = await loadBoth();
      const connection = ipc.feed.connect(contents);
      const closed = vi.fn();
      connection.onClose(closed);

      connection.close();

      expect(closed).toHaveBeenCalledOnce();
      expect(contents.send).toHaveBeenCalledExactlyOnceWith(closeWire("feed"), "1:main");
      expect(listenerOf(fake, closeWire("feed"))).toBeTypeOf("function");
   });
});
