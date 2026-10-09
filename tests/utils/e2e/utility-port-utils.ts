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
import {
   createFakeElectron,
   createFakePreloadElectron,
   loadGenerated,
} from "@testutils/e2e/runtime-utils.js";
import { fixtures } from "../fixture-tracker.js";
import { createContents } from "./fake-contents.js";
import { channelsMade, FakeChannelMain, FakePagePort } from "./fake-ports.js";
import {
   createChild,
   createParentPort,
   resetUtilityProcessFakes,
   setAttachChild,
} from "./fake-utility.js";
import { closeWire, wire } from "./wire-utils.js";

const rawPorts: MessagePort[] = [];

export async function loadMain(channelClass: unknown = FakeChannelMain) {
   const project = await fixtures.run("utility-ports");
   channelsMade.length = 0;
   const electron = { ...createFakeElectron(), MessageChannelMain: channelClass };
   const main = loadGenerated(project.generated["main.ts"], { electron });
   setAttachChild(main.attachUtility);
   return main.ipc;
}

export async function loadUtility() {
   const project = await fixtures.run("utility-ports");
   const parent = createParentPort();
   const utility = loadGenerated(project.generated["utility.ts"] ?? "", {});
   return { ...parent, ipc: utility.ipc };
}

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

export async function loadPage() {
   const project = await fixtures.run("utility-ports");
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
   const project = await fixtures.run("utility-ports");
   const electron = { ...createFakeElectron(), MessageChannelMain: RealChannelMain };
   const mainModule = loadGenerated(project.generated["main.ts"], { electron });
   setAttachChild(mainModule.attachUtility);
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

   const { child } = createChild();
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

/** Closes what the helpers of this module opened */
export function cleanupUtilityPorts() {
   resetUtilityProcessFakes();
   for (const port of rawPorts.splice(0)) {
      port.close();
   }
}
