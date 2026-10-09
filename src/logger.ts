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

import path from "node:path";
import { styleText } from "node:util";
import type * as t from "@types";
import { toPosix } from "./utils.js";

function paint(color: "yellow" | "green" | "red", text: string): string {
   return styleText(color, text, { stream: process.stderr });
}

function formatOutput(messages: string[], icon: string): string {
   const leadingIcon = `${icon.length === 1 ? " " : ""}${icon} – `;
   const leadingSpace = " ".repeat(leadingIcon.length);
   return messages
      .map((row, index) => {
         const prefix = index === 0 ? leadingIcon : leadingSpace;
         return `${prefix}${row}`;
      })
      .join("\n");
}

function warn(messages: string[]): void {
   console.warn(paint("yellow", formatOutput(messages, "⚠️")));
}

function success(messages: string[]): void {
   console.warn(paint("green", formatOutput(messages, "✔")));
}

function error(messages: string[]): void {
   console.error(paint("red", formatOutput(messages, "✖")));
}

/** A path relative to the project root with `/` separators, or in full when it is outside it. */
function displayPath(fullPath: string, projectRoot?: string): string {
   const relative = projectRoot ? path.relative(projectRoot, fullPath) : "";
   const inside = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
   return inside ? toPosix(relative) : fullPath;
}

export function nonExistentSchemaPath(path: string): void {
   warn(["Skipping IPC automation, because schema path does not exist:", path]);
}

export function noChannelExpressions(path: string): void {
   warn(["Skipping IPC automation, because no channels were found in path:", path]);
}

export function cloneWarnings(messages: string[]): void {
   if (messages.length > 0) {
      warn(messages);
   }
}

export function cannotExecuteChannels(): void {
   if (!(global as any)?.warnedIncorrectUsageOnce) {
      warn(["IPC automation channel expressions have no effect when executed by JavaScript."]);
      (global as any).warnedIncorrectUsageOnce = true;
   }
}

export function fatalError(err: unknown): void {
   const message = err instanceof Error ? err.message : String(err);
   error(["IPC automation failed:", ...message.split("\n")]);
}

/**
 * Reports the schema files that bindings were generated from. Paths are shown relative to the
 * project root, with `/` separators. A path outside the project, or any path when the root is
 * unknown, is shown in full.
 */
export function reportSuccess(pfsArray: t.ParsedFileSpecs[], projectRoot?: string): void {
   success([
      "Successfully generated IPC bindings:",
      ...pfsArray.map((pfs) => {
         const count = pfs.specs.channelSpecArray.length;
         return `${count} channels from path '${displayPath(pfs.fullPath, projectRoot)}'`;
      }),
   ]);
}

/**
 * Reports the result of `--check`: the generated files that are out of date, one per line, or
 * that all are up to date when `paths` is empty. Paths are shown like those of `reportSuccess`.
 */
export function staleFiles(paths: string[], projectRoot?: string): void {
   if (paths.length === 0) {
      success(["Generated files are up to date."]);
      return;
   }
   error(["Generated files are out of date:", ...paths.map((p) => displayPath(p, projectRoot))]);
}

export default {
   nonExistentSchemaPath,
   noChannelExpressions,
   cannotExecuteChannels,
   cloneWarnings,
   fatalError,
   reportSuccess,
   staleFiles,
};
