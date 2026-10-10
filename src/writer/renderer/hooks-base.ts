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

import { BaseWriter } from "../base-writer.js";

const TYPE_ALIASES = `
/** The name of a channel that pushes events to the page: one with \`on\` and \`once\`. */
export type EventName = {
   [N in keyof IpcApi]: IpcApi[N] extends {
      on: (...args: any[]) => any;
      once: (...args: any[]) => any;
   }
      ? N
      : never;
}[keyof IpcApi];

/** The callback that an event channel passes to its listeners. */
export type EventCallback<N extends EventName> = IpcApi[N] extends {
   on: (callback: infer C) => any;
}
   ? C
   : never;

/** The name of a channel that the page calls and the main process answers: one with \`invoke\`. */
export type InvokeName = {
   [N in keyof IpcApi]: IpcApi[N] extends { invoke: (...args: any[]) => any } ? N : never;
}[keyof IpcApi];

/** The parameters of an \`invoke\` channel, as a tuple. */
export type InvokeArgs<N extends InvokeName> = IpcApi[N] extends {
   invoke: (...args: infer A) => any;
}
   ? A
   : never;

/** What a call of an \`invoke\` channel resolves to. */
export type InvokeReturn<N extends InvokeName> = IpcApi[N] extends {
   invoke: (...args: any[]) => Promise<infer R>;
}
   ? R
   : never;
`;

/**
 * The base of the writers of framework hooks (`hooks.react.ts`, `hooks.vue.ts`). The file is for
 * the surface of no scope: it takes `IpcApi` from the types module, and reaches the API through
 * the global of `exposeAs`. A subclass names the imports of its framework and the hooks.
 */
export abstract class FrameworkHooksWriter extends BaseWriter {
   protected abstract getFrameworkImports(): string;
   /** The hooks, in a template whose indent is 3 spaces, which `reindent` turns into the configured one. */
   protected abstract getHooks(): string;
   protected getTargetFilePath(): string {
      return this.config.hooksFilePath;
   }
   protected getTypesFilePath(): string {
      return this.config.typesFilePath;
   }
   /** The file exists whatever the schema has: without the channels, the name types are `never`. */
   protected isEmpty(): boolean {
      return false;
   }
   /** Turns the 3-space indents of a template into the ones of the config. */
   protected reindent(template: string): string {
      const unit = this.indents[0];
      return template.replace(/^( {3})+/gm, (spaces) => unit.repeat(spaces.length / 3));
   }
   protected renderFileContents(): string {
      const typesPath = this.importsGenerator.getFileImportPath(this.getTypesFilePath());
      const api = JSON.stringify(this.getExposeAs());
      return this.joinComponents([
         this.getFrameworkImports(),
         `import type { IpcApi } from ${JSON.stringify(typesPath)};`,
         this.reindent(TYPE_ALIASES),
         this.reindent(
            [
               "\n/** The API that the preload script exposed. */",
               "function api(): IpcApi {",
               `   return (globalThis as unknown as Record<string, IpcApi>)[${api}];`,
               "}",
            ].join("\n"),
         ),
         `${this.reindent(this.getHooks()).trimEnd()}\n`,
      ]);
   }
}
