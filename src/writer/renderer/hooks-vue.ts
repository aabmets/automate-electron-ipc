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

/** The composables. The indent of the template is 3 spaces, which `reindent` turns into the configured one. */
const HOOKS = `
/**
 * Subscribes to an event channel at once, and unsubscribes when the active effect scope is
 * disposed: when the component unmounts, if it is called in \`setup\`.
 */
export function useIpcEvent<N extends EventName>(name: N, callback: EventCallback<N>): void {
   const events = api()[name] as unknown as {
      on(callback: (...args: unknown[]) => void): () => void;
   };
   const unsubscribe = events.on((...args) => (callback as (...args: unknown[]) => void)(...args));
   onScopeDispose(unsubscribe);
}

/**
 * Calls an \`invoke\` channel and keeps the state of the latest call. \`invoke\` resolves with the
 * result and rejects with the error, like the call of the channel does, and also sets \`data\` or
 * \`error\`. The result of a call that finishes after the scope was disposed, or after a newer call
 * started, does not change the state. \`data\` keeps the last result when a call fails.
 */
export function useIpcInvoke<N extends InvokeName>(
   name: N,
): {
   invoke(...args: InvokeArgs<N>): Promise<InvokeReturn<N>>;
   data: ShallowRef<InvokeReturn<N> | undefined>;
   error: ShallowRef<unknown>;
   pending: Ref<boolean>;
} {
   const data: ShallowRef<InvokeReturn<N> | undefined> = shallowRef(undefined);
   const error: ShallowRef<unknown> = shallowRef(undefined);
   const pending = ref(false);
   let disposed = false;
   let latestCall = 0;
   onScopeDispose(() => {
      disposed = true;
   });
   async function invoke(...args: InvokeArgs<N>): Promise<InvokeReturn<N>> {
      const call = ++latestCall;
      const isCurrent = () => !disposed && call === latestCall;
      error.value = undefined;
      pending.value = true;
      try {
         const channel = api()[name] as unknown as {
            invoke(...args: unknown[]): Promise<unknown>;
         };
         const result = (await channel.invoke(...args)) as InvokeReturn<N>;
         if (isCurrent()) {
            data.value = result;
            pending.value = false;
         }
         return result;
      } catch (failure) {
         if (isCurrent()) {
            error.value = failure;
            pending.value = false;
         }
         throw failure;
      }
   }
   return { invoke, data, error, pending };
}
`;

/**
 * Writes `hooks.vue.ts`, the Vue composables for the API of the page: `useIpcEvent` for the
 * channels that push events to the page, and `useIpcInvoke` for the ones the page calls. They take
 * the API from the global of `exposeAs`, and the types from the types module of the surface of no
 * scope. The generated file imports `vue`; the library itself does not depend on it.
 */
export class VueHooksWriter extends FrameworkHooksWriter {
   protected getFrameworkImports(): string {
      return [
         'import { onScopeDispose, ref, shallowRef } from "vue";',
         'import type { Ref, ShallowRef } from "vue";',
      ].join("\n");
   }
   protected getHooks(): string {
      return HOOKS;
   }
}
