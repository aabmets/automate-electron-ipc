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

import { createFakePreloadElectron, loadGenerated } from "@testutils/runtime-utils.js";
import { generateFixture, portWire } from "@testutils/stream-main-utils.js";
import { vi } from "vitest";

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
   deliver(data: unknown) {
      this.onmessage?.({ data });
   }
   emitClose() {
      for (const listener of this.closeListeners) {
         listener();
      }
   }
}

export async function loadPreload() {
   const project = await generateFixture("stream-channels");
   const fake = createFakePreloadElectron();
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   const invoke = fake.electron.ipcRenderer.invoke;
   invoke.mockResolvedValue({ ok: true, value: undefined });
   /** Hands a port to the page, the way the main process does. */
   const arrive = (
      name: string,
      id: unknown,
      port: FakePagePort | undefined = new FakePagePort(),
   ) => {
      const call = fake.electron.ipcRenderer.on.mock.calls.find(
         ([channel]: [string]) => channel === portWire(name),
      );
      if (!call) {
         throw new Error(`The preload script does not listen on '${portWire(name)}'`);
      }
      (call[1] as (event: unknown, id: unknown) => void)({ ports: port ? [port] : [] }, id);
      return port;
   };
   return { api: fake.exposed.ipc, invoke, arrive, fake };
}

/** What a read of the stream settles with, as a plain description. */
export async function settleRead(promise: Promise<unknown>) {
   return promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
   );
}
