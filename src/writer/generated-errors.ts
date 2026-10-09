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

/**
 * Pieces of runtime code which several generated files carry in the same shape: the error class
 * and the reply reader of `ask` and utility process calls, and the clamp of a timer delay. The
 * other `Ipc*Error` classes differ in shape and are written where they are used.
 */

/** The largest delay of `setTimeout`; a larger one fires at once. */
export const MAX_TIMER_DELAY = 2147483647;

/** The generated expression which keeps `timeoutMs` within the largest delay of a timer. */
export const CLAMPED_TIMEOUT = `Math.min(timeoutMs, ${MAX_TIMER_DELAY})`;

/** The class of a failed `ask` or utility call, which carries the `channel`, `code` and `data`. */
export function errorClassLines(indents: string[], className: string): string[] {
   const [i1, i2] = indents;
   return [
      `export class ${className} extends Error {`,
      `${i1}readonly code: string | number | undefined;`,
      `${i1}readonly channel: string;`,
      `${i1}readonly data: unknown;`,
      `${i1}constructor(channel: string, message: string, code?: string | number, name = '${className}', data?: unknown) {`,
      `${i2}super(message);`,
      `${i2}this.name = name;`,
      `${i2}this.channel = channel;`,
      `${i2}this.code = code;`,
      `${i2}this.data = data;`,
      `${i1}}`,
      "}",
   ];
}

/** What differs between the reply readers: the names, and the texts of the two failures. */
export interface ReplyReaderOptions {
   /** The name of the generated function. */
   fn: string;
   /** The error class of the failures, from `errorClassLines`. */
   errorClass: string;
   /** The code of an envelope of an unknown shape. */
   invalidCode: string;
   /** A TypeScript expression for the message of an envelope of an unknown shape. */
   invalidMessage: string;
   /** A TypeScript expression for the message of an error envelope which has none. */
   missingMessage: string;
   /** A parameter after `envelope`, which the two messages may read. */
   extraParam?: string;
}

/** A reader of the envelope of a reply, which turns it into a value or an error of the class. */
export function replyReaderLines(indents: string[], options: ReplyReaderOptions): string[] {
   const [i1, i2] = indents;
   const { fn, errorClass, invalidCode, invalidMessage, missingMessage, extraParam } = options;
   const params = `channel: string, envelope: unknown${extraParam ? `, ${extraParam}` : ""}`;
   return [
      `function ${fn}(${params}): { value: unknown } | { error: ${errorClass} } {`,
      `${i1}const source = typeof envelope === 'object' && envelope !== null ? (envelope as { [key: string]: unknown }) : null;`,
      `${i1}if (source && source.ok === true) {`,
      `${i2}return { value: source.value };`,
      `${i1}}`,
      `${i1}const error = source && typeof source.error === 'object' && source.error !== null ? (source.error as { [key: string]: unknown }) : null;`,
      `${i1}if (!source || source.ok !== false || !error) {`,
      `${i2}return { error: new ${errorClass}(channel, ${invalidMessage}, '${invalidCode}') };`,
      `${i1}}`,
      `${i1}const name = typeof error.name === 'string' && error.name ? error.name : 'Error';`,
      `${i1}const message = typeof error.message === 'string' ? error.message : ${missingMessage};`,
      `${i1}const code = typeof error.code === 'string' || typeof error.code === 'number' ? error.code : undefined;`,
      `${i1}return { error: new ${errorClass}(channel, message, code, name, error.data) };`,
      "}",
   ];
}
