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
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import {
   createFakeElectron,
   createFakePreloadElectron,
   finishLoading,
   loadGenerated,
} from "@testutils/runtime-utils.js";
import { AT, date, listenerOf, loadSerializer, settle } from "@testutils/serializer-wire-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

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
   const serializer = await loadSerializer(project);
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
