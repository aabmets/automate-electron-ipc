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

// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures, and have nothing to await
// biome-ignore-all lint/style/useThrowOnlyError: a plain object is what a handler may throw, and the library reduces it

import { EventEmitter } from "node:events";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import {
   createFakeElectron,
   createFakePreloadElectron,
   loadGenerated,
   settlePorts,
} from "@testutils/runtime-utils.js";
import { vi } from "vitest";

/** `attachUtility` of the loaded `main.ts`: the children of the tests are attached when made (T86). */
let attachChild: ((child: unknown) => void) | undefined;
const rawPorts: MessagePort[] = [];
let project: E2EProject | undefined;

export const wire = (name: string) => `autoipc:${name}`;
export const closeWire = (name: string) => `autoipc:${name}:close`;

/** Lets the promises and the events of the ports run. */
export const settle = () => settlePorts(20);
export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Contents that are loaded unless told otherwise, as an emitter that records what is sent to it. */
export function createContents(state: { loading?: boolean; url?: string; id?: number } = {}) {
   const contents = Object.assign(new EventEmitter(), {
      id: state.id ?? 1,
      loading: state.loading ?? false,
      url: state.url ?? "app://.",
      destroyed: false,
      postMessage: vi.fn(),
      send: vi.fn(),
      isLoading: () => contents.loading,
      getURL: () => contents.url,
      isDestroyed: () => contents.destroyed,
   });
   return contents;
}

/**
 * A `UtilityProcess` stand-in, which the main process pairs the page with. It is attached to the
 * bindings like a child from `forkUtility`, unless `attached` is false.
 */
export function createChild({ attached = true } = {}) {
   const child = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
   if (attached) {
      attachChild?.(child);
   }
   return child;
}

/** The ports a `MessageChannelMain` made, in order. */
export const channelsMade: {
   port1: { close: ReturnType<typeof vi.fn> };
   port2: { close: ReturnType<typeof vi.fn> };
}[] = [];

export class FakeChannelMain {
   port1 = { name: `port1 of ${channelsMade.length + 1}`, close: vi.fn() };
   port2 = { name: `port2 of ${channelsMade.length + 1}`, close: vi.fn() };
   constructor() {
      channelsMade.push(this);
   }
}

export async function loadMain(channelClass: unknown = FakeChannelMain) {
   project = await runFixture("utility-ports");
   channelsMade.length = 0;
   const electron = { ...createFakeElectron(), MessageChannelMain: channelClass };
   const main = loadGenerated(project.generated["main.ts"], { electron });
   attachChild = main.attachUtility;
   return main.ipc;
}

/** A `MessagePortMain` of the child: an emitter with the methods of the generated code. */
export class FakeBrokerPort extends EventEmitter {
   readonly postMessage = vi.fn();
   readonly start = vi.fn();
   readonly close = vi.fn();
   /** The page posts a message. */
   fromPage(data: unknown) {
      this.emit("message", { data });
   }
   /** What was posted to the page, with the given tag. */
   posted(tag?: string) {
      return this.postMessage.mock.calls
         .map(([message]) => message as Record<string, any>)
         .filter((message) => tag === undefined || message.__ipc === tag);
   }
}

/** A `process.parentPort` stand-in, which the code in the utility process uses. */
export function createParentPort() {
   const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
   (process as unknown as { parentPort: unknown }).parentPort = port;
   /** The main process posts a message to the child, with the ports it transfers. */
   const emitFromMain = (data: unknown, ports?: unknown[]) => port.emit("message", { data, ports });
   /** The main process hands a brokered port to the child. */
   const broker = (channel: string, key = "1:utility", brokerPort = new FakeBrokerPort()) => {
      emitFromMain({ __ipc: "port", channel: wire(channel), key }, [brokerPort]);
      return brokerPort;
   };
   return { port, emitFromMain, broker };
}

export async function loadUtility() {
   project = await runFixture("utility-ports");
   const parent = createParentPort();
   const utility = loadGenerated(project.generated["utility.ts"] ?? "", {});
   return { ...parent, ipc: utility.ipc };
}

export const ok = (value: unknown) => ({ ok: true, value });
export const call = (channel: string, id: number, ...args: unknown[]) => ({
   __ipc: "call",
   channel: wire(channel),
   id,
   args,
});
export const startStream = (channel: string, id: number, ...args: unknown[]) => ({
   __ipc: "stream",
   channel: wire(channel),
   id,
   args,
});
export const cancel = (channel: string, id: number) => ({
   __ipc: "cancel",
   channel: wire(channel),
   id,
});

/** A `MessagePort` of the page: records what is posted, and delivers what the test says. */
export class FakePagePort {
   onmessage: ((event: { data: unknown }) => void) | null = null;
   readonly postMessage = vi.fn();
   readonly close = vi.fn();
   private readonly closeListeners: (() => void)[] = [];
   addEventListener(type: string, listener: () => void) {
      if (type === "close") {
         this.closeListeners.push(listener);
      }
   }
   /** The child posts a message to the page. */
   deliver(data: unknown) {
      this.onmessage?.({ data });
   }
   emitClose() {
      for (const listener of this.closeListeners) {
         listener();
      }
   }
   /** What the page posted to the child, with the given tag. */
   posted(tag: string) {
      return this.postMessage.mock.calls
         .map(([message]) => message as Record<string, any>)
         .filter((message) => message.__ipc === tag);
   }
}

export async function loadPage() {
   project = await runFixture("utility-ports");
   const fake = createFakePreloadElectron();
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   const listener = (channel: string) => {
      const found = fake.electron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === channel,
      );
      if (!found) {
         throw new Error(`The preload script does not listen on '${channel}'`);
      }
      return found[1] as (event: unknown, key: unknown) => void;
   };
   /** Hands a port to the page, the way the main process does. */
   const arrive = (
      name: string,
      key: unknown = "1:utility",
      port: FakePagePort | null = new FakePagePort(),
   ) => {
      listener(wire(name))({ ports: port ? [port] : [] }, key);
      return port as FakePagePort;
   };
   /** The main process tells the page that the connection has ended. */
   const closeFromMain = (name: string, key: unknown) => listener(closeWire(name))({}, key);
   return { api: fake.exposed.ipc, arrive, closeFromMain, fake };
}

/** What a promise settles with, as a plain description. */
export const settled = (promise: Promise<unknown>) =>
   promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
   );

/** A `MessagePortMain` on top of a real `MessagePort`, so that the ports really carry messages. */
export class RealPortMain extends EventEmitter {
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
      this.raw.postMessage(message);
   }
   close() {
      this.raw.close();
   }
}

export class RealChannelMain {
   port1: RealPortMain;
   port2: MessagePort;
   constructor() {
      const channel = new MessageChannel();
      this.port1 = new RealPortMain(channel.port1);
      this.port2 = channel.port2;
      rawPorts.push(channel.port2);
   }
}

/** The three generated scripts, wired to each other the way Electron does for one page and one child. */
export async function loadAll() {
   project = await runFixture("utility-ports");
   const electron = { ...createFakeElectron(), MessageChannelMain: RealChannelMain };
   const mainModule = loadGenerated(project.generated["main.ts"], { electron });
   attachChild = mainModule.attachUtility;
   const main = mainModule.ipc;
   const parent = createParentPort();
   const utility = loadGenerated(project.generated["utility.ts"] ?? "", {}).ipc;
   const fake = createFakePreloadElectron();
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   const listener = (channel: string) =>
      fake.electron.ipcRenderer.on.mock.calls.find(([name]: [string]) => name === channel)?.[1] as (
         event: unknown,
         key: unknown,
      ) => void;

   const child = createChild();
   child.postMessage.mockImplementation((message: unknown, ports?: unknown[]) =>
      parent.emitFromMain(message, ports),
   );
   const contents = createContents();
   contents.postMessage.mockImplementation((channel: string, key: unknown, ports: unknown[]) =>
      listener(channel)({ ports }, key),
   );
   contents.send.mockImplementation((channel: string, key: unknown) => listener(channel)({}, key));
   return { main, utility, page: fake.exposed.ipc, child, contents };
}

/** Closes what the helpers of this module opened, and removes their project. */
export async function cleanupUtilityPorts() {
   attachChild = undefined;
   Reflect.deleteProperty(process, "parentPort");
   for (const port of rawPorts.splice(0)) {
      port.close();
   }
   await project?.cleanup();
   project = undefined;
}
