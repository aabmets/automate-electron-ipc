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

export function concatRegex(parts: RegExp[], flags = ""): RegExp {
   const pattern = parts.map((part) => part.source).join("");
   return new RegExp(pattern, flags);
}

/**
 * Removes the smallest indentation of the non-blank lines from every line, which keeps the
 * relative indentation of the lines.
 */
export function dedent(text: string): string {
   const lines = text.split("\n");
   const indent = lines
      .filter((line) => line.trim())
      .reduce(
         (minIndent, line) => Math.min(minIndent, /^(\s*)/.exec(line)?.[0].length ?? 0),
         Number.POSITIVE_INFINITY,
      );
   return lines.map((line) => line.slice(indent)).join("\n");
}
