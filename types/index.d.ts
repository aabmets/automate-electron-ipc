/*
 *   MIT License
 *
 *   Copyright (c) 2024, Mattias Aabmets
 *
 *   The contents of this file are subject to the terms and conditions defined in the License.
 *   You may not use, modify, or distribute this file except in compliance with the License.
 *
 *   SPDX-License-Identifier: MIT
 */

import type { Plugin } from "vite";

export interface IPCOptionalConfig {
   ipcSpecPath?: string;
   rendererDir?: string;
   codeIndent?: number;
}

declare module "vite-plugin-automate-electron-ipc" {
   export function ipcAutomation(config?: IPCOptionalConfig): Plugin;
}
