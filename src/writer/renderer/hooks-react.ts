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

import { FrameworkHooksWriter } from "./hooks-base.js";

/** The hooks. The indent of the template is 3 spaces, which `reindent` turns into the configured one. */
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
export class ReactHooksWriter extends FrameworkHooksWriter {
   protected getFrameworkImports(): string {
      return 'import { useCallback, useEffect, useRef, useState } from "react";';
   }
   protected getHooks(): string {
      return HOOKS;
   }
}
