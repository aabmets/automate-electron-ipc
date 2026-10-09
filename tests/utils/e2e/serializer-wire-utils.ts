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

import fsp from "node:fs/promises";
import path from "node:path";
import type { E2EProject } from "../e2e-utils.js";
import { type createFakePreloadElectron, loadGenerated, settlePorts } from "./runtime-utils.js";

/** Lets the messages and the events of the real ports, and the promises, run. */
export const settle = () => settlePorts(20);

/** What `Date`, `Set` and `Map` look like on the wire, in the serializer of the fixture. */
export const date = (iso: string) => ({ $: "Date", v: iso });
export const AT = "2026-10-09T10:00:00.000Z";

/** What a promise settles with, as a plain description. */
export const settled = (promise: Promise<unknown>) =>
   promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
   );

/** The serializer module of the fixture, which the generated files import. */
export async function loadSerializer(project: E2EProject) {
   const text = await fsp.readFile(path.join(project.dir, "ipc", "serializer.ts"), "utf8");
   return loadGenerated(text, {});
}

/** The listener that a generated preload script registered on a wire channel. */
export function listenerOf(fake: ReturnType<typeof createFakePreloadElectron>, name: string) {
   const call = fake.electron.ipcRenderer.on.mock.calls.find(
      ([channel]: [string]) => channel === name,
   );
   return call?.[1] as (...args: unknown[]) => void;
}
