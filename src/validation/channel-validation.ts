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

import type * as t from "@types";
import { schemaFilePrefix } from "../parser/diagnostics.js";
import { validateChannelSpecWithStruct } from "./channel-spec-structs.js";
import { validateCloneIssues } from "./clone-issues.js";

/**
 * Throws if `maxQueue` or `highWaterMark` is not a non-negative safe integer or `Infinity`. The
 * parser reports the same for the schema file, so this guards the specs that did not come from it.
 */
function validateCountLimit(
   spec: Partial<t.ChannelSpec>,
   option: "maxQueue" | "highWaterMark",
   file?: string,
): void {
   const value = spec[option];
   if (value === undefined || value === Number.POSITIVE_INFINITY) {
      return;
   } else if (!Number.isSafeInteger(value) || value < 0) {
      const where = schemaFilePrefix(file, spec.loc);
      throw new Error(
         `${where}Channel '${spec.name}': ${option} must be a non-negative integer or Infinity, ` +
            `found ${value}.`,
      );
   }
}

/**
 * Throws if `timeoutMs` is not a non-negative safe integer. The parser reports the same for the
 * schema file, so this guards the specs that did not come from it.
 */
function validateTimeoutMs(spec: Partial<t.ChannelSpec>, file?: string): void {
   const value = spec.timeoutMs;
   if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      const where = schemaFilePrefix(file, spec.loc);
      throw new Error(
         `${where}Channel '${spec.name}': timeoutMs must be a non-negative integer, found ${value}.`,
      );
   }
}

/**
 * The names that every object has, such as `constructor` and `toString`. A channel object with
 * such a key would hide the member or, as `__proto__` does, change the prototype of the API.
 */
const OBJECT_MEMBER_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype));

/**
 * Validates the channel specs of one schema file. `file` is only used in error messages.
 */
export function validateChannelSpecs(
   specs: Partial<t.ChannelSpec>[],
   file?: string,
): t.ChannelSpec[] {
   const seenChannelNames = new Set<string>();
   for (const spec of specs) {
      if (spec?.name !== undefined && OBJECT_MEMBER_NAMES.has(spec.name)) {
         const where = schemaFilePrefix(file, spec.loc);
         throw new Error(
            `${where}Channel name '${spec.name}' is reserved, since it is a member of every ` +
               "object. Choose another name.",
         );
      }
      validateChannelSpecWithStruct(spec);
      validateCountLimit(spec, "maxQueue", file);
      validateCountLimit(spec, "highWaterMark", file);
      validateTimeoutMs(spec, file);
      validateCloneIssues(spec, file);

      if (spec?.name) {
         if (seenChannelNames.has(spec.name)) {
            throw new Error(`Channel name '${spec.name}' is not unique across application.`);
         } else {
            seenChannelNames.add((spec as t.ChannelSpec).name);
         }
      }

      // The struct has accepted the spec, so its kind and signature are there.
      const { kind, signature } = spec as t.ChannelSpec;
      const returnType = signature.returnType;
      // The parser decides from the AST. Specs that did not come from it fall back to the text.
      const isVoid =
         signature.returnsVoid ??
         ["void", "Promise<void>"].includes(returnType.replaceAll(/\s+/g, ""));
      const isLimited = ["Broadcast", "Port"].includes(kind);
      if (isLimited && !isVoid) {
         throw new Error(
            `Channel return type '${returnType}' not allowed when channel kind is '${kind}'`,
         );
      }
   }
   return specs as t.ChannelSpec[];
}
