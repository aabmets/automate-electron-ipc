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
import { vi } from "vitest";
import { type E2EProject, runFixture } from "./e2e-utils.js";
import { createFakePreloadElectron, loadGenerated } from "./runtime-utils.js";
import { loadSerializer } from "./serializer-wire-utils.js";
import { wire } from "./service-worker-utils.js";

/**
 * Makes the `loadBrokered` function of one test file. `track` gets the project of each run, and
 * `rawPorts` collects the real ports, so that the file can close them in its own `afterEach`.
 */
export function brokeredLoader(track: (project: E2EProject) => void, rawPorts: MessagePort[]) {
   /** A `MessagePortMain` of the child, over a real `MessagePort`. */
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
         this.raw.postMessage(message);
      }
      close() {
         this.raw.close();
      }
   }

   /** A page, the child, and the real port between them, which the test can also read and write. */
   async function loadBrokered() {
      const project = await runFixture("serializer-utility");
      track(project);
      const serializer = await loadSerializer(project);
      const parentPort = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
      (process as unknown as { parentPort: unknown }).parentPort = parentPort;
      const utility = loadGenerated(project.generated["utility.ts"] ?? "", {
         "./serializer": serializer,
      });
      const fake = createFakePreloadElectron();
      loadGenerated(project.generated["preload.ts"], {
         electron: fake.electron,
         "./serializer": serializer,
      });
      const listener = (channel: string) =>
         fake.electron.ipcRenderer.on.mock.calls.find(
            ([name]: [string]) => name === channel,
         )?.[1] as (event: unknown, key: unknown) => void;
      /** Pairs the page with the child for a channel, as the main process does. */
      const connect = (name: string) => {
         const channel = new MessageChannel();
         rawPorts.push(channel.port1, channel.port2);
         parentPort.emit("message", {
            data: { __ipc: "port", channel: wire(name), key: "1:utility" },
            ports: [new RealPortMain(channel.port1)],
         });
         listener(wire(name))({ ports: [channel.port2] }, "1:utility");
      };
      /** Pairs the page with a port that the test holds, instead of the child. */
      const holdPage = (name: string) => {
         const channel = new MessageChannel();
         rawPorts.push(channel.port1, channel.port2);
         listener(wire(name))({ ports: [channel.port2] }, "1:utility");
         return channel.port1;
      };
      /** Hands the child a port that the test holds, instead of a page. */
      const holdChild = (name: string) => {
         const channel = new MessageChannel();
         rawPorts.push(channel.port1, channel.port2);
         parentPort.emit("message", {
            data: { __ipc: "port", channel: wire(name), key: "1:utility" },
            ports: [new RealPortMain(channel.port1)],
         });
         return channel.port2;
      };
      return { utility: utility.ipc, page: fake.exposed.ipc, connect, holdPage, holdChild };
   }
   return loadBrokered;
}
