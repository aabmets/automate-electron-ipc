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

import { comparePaths } from "../utils.js";
import { SchemaError } from "./diagnostics.js";

/** The number of errors that a `SchemaErrors` keeps. */
export const MAX_REPORTED_ERRORS = 20;

const NO_POSITION = { line: 0, column: 0 };

function compareErrors(a: SchemaError, b: SchemaError): number {
   const [from, to] = [a.position ?? NO_POSITION, b.position ?? NO_POSITION];
   return comparePaths(a.file, b.file) || from.line - to.line || from.column - to.column;
}

/**
 * Raised when a run finds more than one schema error. `errors` holds the first
 * `MAX_REPORTED_ERRORS` of them, sorted by file, then line, then column, and `omitted` counts the
 * rest. The message joins the messages of the errors with a blank line, followed by
 * `and N more errors` when some are omitted, and by `N errors`.
 */
export class SchemaErrors extends Error {
   readonly errors: SchemaError[];
   readonly omitted: number;

   /**
    * @param errors - The errors found, in any order.
    * @param [omitted] - The number of errors which were found but are not in `errors`.
    */
   constructor(errors: SchemaError[], omitted = 0) {
      const sorted = [...errors].sort(compareErrors);
      const kept = sorted.slice(0, MAX_REPORTED_ERRORS);
      const total = sorted.length + omitted;
      const rest = total - kept.length;
      const parts = kept.map((error) => error.message);
      if (rest > 0) {
         parts.push(`and ${rest} more ${rest === 1 ? "error" : "errors"}`);
      }
      if (total > 1) {
         parts.push(`${total} errors`);
      }
      super(parts.join("\n\n"));
      this.name = "SchemaErrors";
      this.errors = kept;
      this.omitted = rest;
   }
}

/** Tells whether a thrown value is a schema error, or a report of several of them. */
export function isSchemaFailure(failure: unknown): failure is SchemaError | SchemaErrors {
   return failure instanceof SchemaError || failure instanceof SchemaErrors;
}

/**
 * The error to throw for the schema errors of a run: the `SchemaError` itself when there is one
 * error, so that its message is unchanged, and a `SchemaErrors` for more.
 *
 * @param failures - The errors that were thrown while parsing the files. At least one.
 */
export function toSchemaFailure(
   failures: (SchemaError | SchemaErrors)[],
): SchemaError | SchemaErrors {
   const errors = failures.flatMap((failure) =>
      failure instanceof SchemaErrors ? failure.errors : [failure],
   );
   const omitted = failures.reduce(
      (sum, failure) => sum + (failure instanceof SchemaErrors ? failure.omitted : 0),
      0,
   );
   return errors.length === 1 && omitted === 0 ? errors[0] : new SchemaErrors(errors, omitted);
}
