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

/** The line of the method `method` of the channel object `channel` in a generated file. */
export const methodLine = (text: string, channel: string, method: string): string => {
   const lines = text.split("\n");
   const start = lines.findIndex((line) => line.trim() === `${channel}: {`);
   return lines.slice(start + 1).find((line) => line.trim().startsWith(`${method}:`)) ?? "";
};
