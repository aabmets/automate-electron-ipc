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
import chalk from "chalk";

function formatOutput(messages: string[], icon: string): string {
   const leadingIcon = `${icon.length === 1 ? "  " : " "}${icon} – `;
   const leadingSpace = " ".repeat(leadingIcon.length);
   return messages
      .map((row, index) => {
         const prefix = index === 0 ? leadingIcon : leadingSpace;
         return `${prefix}${row}`;
      })
      .join("\n");
}

function warn(messages: string[]): void {
   console.warn(chalk.yellow(formatOutput(messages, "⚠️")));
}

function success(messages: string[]): void {
   console.warn(chalk.green(formatOutput(messages, "✔")));
}

export function nonExistentSchemaPath(path: string): void {
   warn(["Skipping IPC automation, because schema path does not exist:", path]);
}

export function noChannelExpressions(path: string): void {
   warn(["Skipping IPC automation, because no channels were found in path:", path]);
}

export function cannotExecuteChannels(): void {
   if (!(global as any)?.warnedIncorrectUsageOnce) {
      warn(["IPC automation channel expressions have no effect when executed by JavaScript."]);
      (global as any).warnedIncorrectUsageOnce = true;
   }
}

export function reportSuccess(pfsArray: t.ParsedFileSpecs[]): void {
   success([
      "Successfully generated IPC bindings:",
      ...pfsArray.map((pfs) => {
         const count = pfs.specs.channelSpecArray.length;
         const resultPath = pfs.fullPath.includes(pfs.relativePath)
            ? pfs.fullPath.substring(pfs.fullPath.indexOf(pfs.relativePath))
            : pfs.fullPath;
         return `${count} channels from path '${resultPath}'`;
      }),
   ]);
}

export default {
   nonExistentSchemaPath,
   noChannelExpressions,
   cannotExecuteChannels,
   reportSuccess,
};
