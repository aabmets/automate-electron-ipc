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

/** The type aliases which pick the event and the invoke channels out of `IpcApi`. */
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

/** The hooks. The indent of the template is 3 spaces, which \`reindent\` turns into the configured one. */
const HOOKS = `
/**
 * Subscribes to an event channel while the component is mounted, and unsubscribes when it unmounts
 * or when \`name\` changes. The latest \`callback\` is called, so a new function on each render does
 * not resubscribe.
 */
export function useIpcEvent<N extends EventName>(name: N, callback: EventCallback<N>): void {
   const latest = useRef(callback);
   useEffect(() => {
      latest.current = callback;
   });
   useEffect(() => {
      const events = api()[name] as unknown as {
         on(callback: (...args: unknown[]) => void): () => void;
      };
      return events.on((...args) => (latest.current as (...args: unknown[]) => void)(...args));
   }, [name]);
}

/**
 * Calls an \`invoke\` channel and keeps the state of the latest call. \`invoke\` resolves with the
 * result and rejects with the error, like the call of the channel does, and also sets \`data\` or
 * \`error\`. The result of a call that finishes after the component unmounted, or after a newer
 * call started, does not change the state. \`data\` keeps the last result when a call fails.
 */
export function useIpcInvoke<N extends InvokeName>(
   name: N,
): {
   invoke(...args: InvokeArgs<N>): Promise<InvokeReturn<N>>;
   data: InvokeReturn<N> | undefined;
   error: unknown;
   pending: boolean;
} {
   const [state, setState] = useState<{
      data: InvokeReturn<N> | undefined;
      error: unknown;
      pending: boolean;
   }>({ data: undefined, error: undefined, pending: false });
   const mounted = useRef(true);
   const latestCall = useRef(0);
   useEffect(() => {
      mounted.current = true;
      return () => {
         mounted.current = false;
      };
   }, []);
   const invoke = useCallback(
      async (...args: InvokeArgs<N>): Promise<InvokeReturn<N>> => {
         const call = ++latestCall.current;
         const isCurrent = () => mounted.current && call === latestCall.current;
         setState((previous) => ({ data: previous.data, error: undefined, pending: true }));
         try {
            const channel = api()[name] as unknown as {
               invoke(...args: unknown[]): Promise<unknown>;
            };
            const data = (await channel.invoke(...args)) as InvokeReturn<N>;
            if (isCurrent()) {
               setState({ data, error: undefined, pending: false });
            }
            return data;
         } catch (error) {
            if (isCurrent()) {
               setState((previous) => ({ data: previous.data, error, pending: false }));
            }
            throw error;
         }
      },
      [name],
   );
   return { invoke, data: state.data, error: state.error, pending: state.pending };
}
`;

/**
 * Writes `hooks.react.ts`, the React hooks for the API of the page: `useIpcEvent` for the
 * channels that push events to the page, and `useIpcInvoke` for the ones the page calls. They take
 * the API from the global of `exposeAs`, and the types from the types module of the surface of no
 * scope. The generated file imports `react`; the library itself does not depend on it.
 */
export class ReactHooksWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.config.hooksFilePath;
   }
   /** The path of the types module that the hooks take `IpcApi` from. */
   protected getTypesFilePath(): string {
      return this.config.typesFilePath;
   }
   /** The file exists whatever the schema has: without the channels, the name types are `never`. */
   protected isEmpty(): boolean {
      return false;
   }
   /** Turns the 3-space indents of a template into the ones of the config. */
   private reindent(template: string): string {
      const unit = this.indents[0];
      return template.replace(/^( {3})+/gm, (spaces) => unit.repeat(spaces.length / 3));
   }
   protected renderFileContents(): string {
      const typesPath = this.importsGenerator.getFileImportPath(this.getTypesFilePath());
      const api = JSON.stringify(this.getExposeAs());
      return this.joinComponents([
         'import { useCallback, useEffect, useRef, useState } from "react";',
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
         `${this.reindent(HOOKS).trimEnd()}\n`,
      ]);
   }
}
