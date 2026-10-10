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

function describeCloneIssue(channel: string, issue: t.CloneIssue): string {
   const via = issue.via ? ` through '${issue.via}'` : "";
   return `Channel '${channel}': ${issue.where} contains ${issue.reason} ('${issue.type}')${via}`;
}

/**
 * Throws if a signature contains what the structured clone algorithm rejects. Electron would
 * throw "An object could not be cloned" for it when the channel is used.
 */
export function validateCloneIssues(spec: Partial<t.ChannelSpec>, file?: string): void {
   const errors = (spec.signature?.cloneIssues ?? []).filter((issue) => issue.level === "error");
   if (errors.length === 0) {
      return;
   }
   const where = schemaFilePrefix(file, spec.loc);
   const lines = errors.map((issue) => {
      let hint = CLONE_HINT;
      if (issue.reason === "a Promise") {
         hint = issue.where.startsWith("parameter") ? PROMISE_HINT : NESTED_PROMISE_HINT;
      }
      return `${where}${describeCloneIssue(spec.name ?? "", issue)}. ${hint}`;
   });
   throw new Error(lines.join("\n"));
}

const CLONE_HINT =
   "It cannot be sent over IPC, and Electron throws 'An object could not be cloned'. " +
   "Send plain data instead, and use a channel to call back.";

const PROMISE_HINT =
   "It cannot be sent over IPC. Only the result of an 'invoke' channel is a Promise, " +
   "so send the resolved value.";

const NESTED_PROMISE_HINT =
   "It cannot be sent over IPC. Only the result of an async signature is a Promise, " +
   "and only as the outermost type, so await it and send the resolved value.";

/**
 * The warnings about the signatures of one schema file: the types that Electron sends, but
 * not as they are, such as a class instance that loses its prototype and methods.
 */
export function getCloneWarnings(specs: t.ChannelSpec[], file?: string): string[] {
   return specs.flatMap((spec) =>
      (spec.signature.cloneIssues ?? [])
         .filter((issue) => issue.level === "warning")
         .map(
            (issue) =>
               `${schemaFilePrefix(file, spec.loc)}${describeCloneIssue(spec.name, issue)}. ` +
               "An instance loses its prototype and methods over IPC and arrives as a plain " +
               "object. Use an interface or a type alias for the data.",
         ),
   );
}
