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

import { fixtures } from "../fixture-tracker.js";
import { loadGenerated } from "./runtime-utils.js";

/** A call that records its calls, as the generated `Stub` does. */
export interface TestStub {
   (...args: any[]): any;
   calls: any[][];
   impl(fn: (...args: any[]) => any): void;
   reset(): void;
}

/** The exports of the generated `mock.ts`, which the tests use without its types. */
export interface LoadedMock {
   createIpcMock: (overrides?: any) => any;
   installIpcMock: (mock?: any, target?: object) => () => void;
}

/**
 * Runs the fixture and loads the `mock.ts` that it generated. The file has only type imports, so
 * it runs without any module. `config` is merged into the config of the fixture.
 */
export async function loadMock(
   fixture = "mock",
   config?: Record<string, unknown>,
): Promise<LoadedMock> {
   const project = await fixtures.run(fixture, config ? { config } : undefined);
   return loadGenerated(await project.read("mock.ts"), {}) as LoadedMock;
}
