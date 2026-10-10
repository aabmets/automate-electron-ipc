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

import type { Span } from "@swc/core";
import type { SourcePosition } from "@types";
import type { Source } from "./ast.js";

/** Where in the schema source a `SchemaError` happened, see `Source.frame`. */
export interface ErrorSite {
   span: Span;
   src: Source;
}

/**
 * Raised for channel declarations that cannot be turned into channel specs.
 * The message names the schema file, the position when `at` is given, and the channel when known.
 * With `at`, a code frame of the source follows the message.
 */
export class SchemaError extends Error {
   readonly file: string;
   /** The 1-based line and column of the error in the file, when known. */
   position?: SourcePosition;

   constructor(file: string, message: string, channel?: string, at?: ErrorSite) {
      const where = channel === undefined ? "" : ` channel '${channel}':`;
      const position = at === undefined ? undefined : at.src.position(at.span);
      const head = `${schemaFilePrefix(file, position).slice(0, -1)}${where} ${message}`;
      super(at === undefined ? head : `${head}\n\n${at.src.frame(at.span)}`);
      this.name = "SchemaError";
      this.file = file;
      this.position = position;
   }
}

/**
 * The start of an error message that names the schema file, or nothing when the file is unknown.
 *
 * @param [file] - The path of the schema file.
 * @param [loc] - The 1-based line and column in the file, when known.
 * @returns `Schema file '<file>' (<line>:<column>): `, with the trailing space, or an empty string.
 */
export function schemaFilePrefix(file?: string, loc?: SourcePosition): string {
   const position = loc === undefined ? "" : ` (${loc.line}:${loc.column})`;
   return file === undefined ? "" : `Schema file '${file}'${position}: `;
}

/** Tab stops of the code frame, which expands a tab to the next multiple of this width. */
const FRAME_TAB_WIDTH = 4;

const WIDE_RANGES: [number, number][] = [
   [0x1100, 0x115f],
   [0x2e80, 0x303e],
   [0x3041, 0xa4cf],
   [0xac00, 0xd7a3],
   [0xf900, 0xfaff],
   [0xfe30, 0xfe6f],
   [0xff00, 0xff60],
   [0xffe0, 0xffe6],
   [0x1f300, 0x1f64f],
   [0x1f900, 0x1f9ff],
   [0x20000, 0x3fffd],
];

/** The number of terminal columns of a character: 0 for combining marks, 2 for wide ones. */
export function displayWidth(char: string): number {
   const codePoint = char.codePointAt(0) ?? 0;
   if (/^[\p{Mn}\p{Me}\p{Cf}]$/u.test(char)) {
      return 0;
   }
   const isWide =
      WIDE_RANGES.some(([from, to]) => codePoint >= from && codePoint <= to) ||
      /^\p{Emoji_Presentation}$/u.test(char);
   return isWide ? 2 : 1;
}

/** The width of a character at the given column, where a tab fills up to the next tab stop. */
function widthAt(char: string, column: number): number {
   return char === "\t" ? FRAME_TAB_WIDTH - (column % FRAME_TAB_WIDTH) : displayWidth(char);
}

/** Expands the tabs of a line like the code frame of swc does. */
export function expandTabs(line: string): string {
   let column = 0;
   let result = "";
   for (const char of line) {
      const width = widthAt(char, column);
      result += char === "\t" ? " ".repeat(width) : char;
      column += width;
   }
   return result;
}

/** The width of a text in terminal columns, where tabs are expanded like in the code frame. */
function textWidth(text: string): number {
   let width = 0;
   for (const char of expandTabs(text)) {
      width += displayWidth(char);
   }
   return width;
}

/**
 * Renders the code frame of an error: the line of `start` with the line before and after it, a
 * gutter of line numbers, and a caret line under the start (`^`, followed by `~` up to
 * `endColumn`). The columns are 1-based indexes into the line, in UTF-16 code units. Tabs and wide
 * characters are expanded, so that the caret lines up with the code.
 *
 * @param lines - The lines of the source, without line terminators.
 * @param start - The position of the start of the span.
 * @param [endColumn] - The column after the span, when it ends on the line of `start`.
 */
export function renderCodeFrame(
   lines: string[],
   start: SourcePosition,
   endColumn?: number,
): string {
   const index = start.line - 1;
   const first = Math.max(index - 1, 0);
   const last = Math.min(index + 1, lines.length - 1);
   const gutter = String(last + 1).length;
   const rows: string[] = [];
   for (let i = first; i <= last; i++) {
      rows.push(`${String(i + 1).padStart(gutter)} | ${expandTabs(lines[i])}`.trimEnd());
      if (i === index) {
         const before = lines[i].slice(0, start.column - 1);
         const covered = lines[i].slice(start.column - 1, (endColumn ?? start.column) - 1);
         const lead = textWidth(before);
         const length = Math.max(textWidth(before + covered) - lead, 1);
         rows.push(`${" ".repeat(gutter)} | ${" ".repeat(lead)}^${"~".repeat(length - 1)}`);
      }
   }
   return rows.join("\n");
}

const BOM_CHAR = "\uFEFF";

/**
 * Converts the display column of the caret of a code frame to the column that an editor shows,
 * which counts UTF-16 code units, one for a tab. `frameText` is the line as the frame shows it:
 * if it is not the expansion of the source line, the source is not the one that was parsed
 * and null is returned.
 */
function columnInSource(
   source: string,
   line: number,
   frameText: string,
   displayColumn: number,
): number | null {
   const sourceLine = source.split("\n")[line - 1]?.replace(/\r$/, "");
   const clean = (text: string) => text.replaceAll(BOM_CHAR, "").trimEnd();
   if (sourceLine === undefined || clean(expandTabs(sourceLine)) !== clean(frameText)) {
      return null;
   }
   let width = 0;
   let index = 0;
   for (const char of sourceLine) {
      const next = width + widthAt(char, width);
      if (displayColumn < next) {
         break;
      }
      width = next;
      index += char.length;
   }
   return index - (sourceLine.startsWith(BOM_CHAR) ? 1 : 0) + 1;
}

/** The position just after the last character of the text, as 1-based line and column. */
function endOfInput(source: string): { line: number; column: number } {
   const lines = source.replaceAll(BOM_CHAR, "").split("\n");
   const last = lines[lines.length - 1].replace(/\r$/, "");
   return { line: lines.length, column: last.length + 1 };
}

/**
 * Extracts the reason and the position of a syntax error from the message of an swc parse error,
 * which is a miette-style code frame. The caret line locates the column, in display columns,
 * and the number in front of the code row gives the line. With the parsed `source`, the column
 * is converted to the one that an editor shows (tabs and wide characters count differently), and
 * an error without a caret, which is an error at the end of the input, is given that position.
 */
export function describeSyntaxError(
   error: unknown,
   source?: string,
): {
   reason: string;
   line?: number;
   column?: number;
} {
   const message = error instanceof Error ? error.message : String(error);
   const lines = message.split("\n");
   const reason =
      lines
         .find((row) => row.trim())
         ?.replace(/^\s*x\s+/, "")
         .trim() ?? "Syntax error";
   const caretIndex = lines.findIndex((row) => /^\s*:\s*\^/.test(row));
   const codeRow = caretIndex > 0 ? /^\s*(\d+)\s*\|\s?(.*)$/.exec(lines[caretIndex - 1]) : null;
   if (caretIndex > 0 && codeRow) {
      const gutter = lines[caretIndex - 1].indexOf("|") + 2;
      const displayColumn = Math.max(lines[caretIndex].indexOf("^") - gutter, 0);
      const line = Number(codeRow[1]);
      const column =
         (source === undefined ? null : columnInSource(source, line, codeRow[2], displayColumn)) ??
         displayColumn + 1;
      return { reason, line, column };
   } else if (source !== undefined && lines.some((row) => /^\s*\d+\s*\|/.test(row))) {
      // A frame without a caret: the error is at the end of the input.
      return { reason, ...endOfInput(source) };
   }
   const header = /\[(\d+):(\d+)\]/.exec(message);
   return header ? { reason, line: Number(header[1]), column: Number(header[2]) } : { reason };
}

/**
 * Raised when a schema file is not valid TypeScript. The message names the file,
 * as `path:line:column` when the position is known. It is a `SchemaError`, so that a run can
 * report it together with the errors of other files, and it keeps its own message.
 */
export class SchemaSyntaxError extends SchemaError {
   constructor(file: string, cause: unknown, source: string) {
      const { reason, line, column } = describeSyntaxError(cause, source);
      super(file, reason);
      const where = line === undefined ? file : `${file}:${line}:${column}`;
      this.message = `Syntax error in schema file '${where}': ${reason}`;
      this.name = "SchemaSyntaxError";
      this.position = line === undefined ? undefined : { line, column: column ?? 1 };
   }
}
