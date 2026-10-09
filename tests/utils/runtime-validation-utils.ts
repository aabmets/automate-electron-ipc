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

import { loadMainWithEmitter } from "@testutils/runtime-main-utils.js";
import { vi } from "vitest";

export const senderFrame = (origin: unknown) => ({
   senderFrame: { origin, url: `${origin}/index.html` },
});
export const loadSenderFixture = () => loadMainWithEmitter("sender-validation");
export const getSecret = (
   handlers: Map<string, (...args: unknown[]) => unknown>,
   event: unknown,
   id = 1,
) => handlers.get("getSecret")?.(event, id);

export type Validate = (value: unknown) => unknown;
/** A hand-written Standard Schema, which records what it was asked to validate. */
export const schema = (validate: Validate) => {
   const wrapped = vi.fn(validate);
   return {
      "~standard": { version: 1, vendor: "test", validate: wrapped },
      validate: wrapped,
   };
};
export const ok = (value: unknown) => ({ value });
export const fail = (message: string) => ({ issues: [{ message }] });
export const isNumber = (value: unknown) =>
   Array.isArray(value) && value.length === 1 && typeof value[0] === "number"
      ? ok(value)
      : fail("expected one number");

export async function loadValidated(
   overrides: { id?: Validate; line?: Validate; none?: Validate } = {},
) {
   const id = schema(overrides.id ?? isNumber);
   const line = schema(overrides.line ?? ok);
   const none = schema(overrides.none ?? ok);
   const loaded = await loadMainWithEmitter("argument-validation", {
      "./validators": { __esModule: true, default: none, idArgs: id, lineArgs: line },
   });
   return { ...loaded, id, line, none };
}
export const inApp = { senderFrame: { origin: "app://." } };
export const callCount = (
   handlers: Map<string, (...args: unknown[]) => unknown>,
   ...args: unknown[]
) => handlers.get("getCount")?.({}, ...args);
