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
import { createFakePreloadElectron, loadGenerated } from "@testutils/e2e/runtime-utils.js";
import {
   createEvent,
   createFrame,
   currentProject,
   loadMainWith,
   rawPorts,
} from "@testutils/e2e/stream-main-utils.js";
import { createContents } from "./fake-contents.js";

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

/** Both generated scripts, wired to each other the way Electron does for one page. */
export async function loadBoth() {
   const main = await loadMainWith(RealChannelMain);
   const fake = createFakePreloadElectron();
   const project = currentProject();
   if (!project) {
      throw new Error("The fixture was not generated");
   }
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   const contents = createContents();
   const frame = createFrame();
   frame.postMessage.mockImplementation((channel: string, id: unknown, ports: unknown[]) => {
      const call = fake.electron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === channel,
      );
      if (!call) {
         throw new Error(`The page does not listen on '${channel}'`);
      }
      (call[1] as (event: unknown, id: unknown) => void)({ ports }, id);
   });
   fake.electron.ipcRenderer.invoke.mockImplementation((channel: string, ...args: unknown[]) => {
      const name = channel.replace("autoipc:", "");
      return main.listener(name)(createEvent(contents, frame), ...args);
   });
   return { ...main, api: fake.exposed.ipc, contents, frame };
}
