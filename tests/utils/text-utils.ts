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
 * Concatenates an array of regular expressions into a single regular expression.
 *
 * @param parts - An array of smaller regex patterns to be concatenated.
 * @param [flags=''] - Optional flags (e.g., 'g', 'i') to apply to the final concatenated regex.
 * @returns A new regular expression composed of the concatenated patterns.
 */
export function concatRegex(parts: RegExp[], flags = ""): RegExp {
   const pattern = parts.map((part) => part.source).join("");
   return new RegExp(pattern, flags);
}

/**
 * Removes the common leading whitespace from each line in a multiline string.
 *
 * This function calculates the minimum indentation level of all non-blank lines and
 * removes that amount of leading whitespace from every line. Useful for cleaning up
 * multiline strings without altering the relative indentation of lines.
 *
 * @param text - The multiline string to dedent.
 * @returns The de-dented string with common leading whitespace removed.
 */
export function dedent(text: string): string {
   const reducer = (minIndent: number, line: string) =>
      Math.min(minIndent, /^(\s*)/.exec(line)?.[0].length ?? 0);
   const lines = text.split("\n");
   const indent = lines
      .filter((line) => line.trim()) // Exclude blank lines
      .reduce(reducer, Number.POSITIVE_INFINITY);
   return lines.map((line) => line.slice(indent)).join("\n");
}
