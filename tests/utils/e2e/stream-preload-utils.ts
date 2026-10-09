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
import { portWire } from "@testutils/e2e/stream-main-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { FakePagePort } from "./fake-ports.js";

export async function loadPreload() {
   const project = await fixtures.run("stream-channels");
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
