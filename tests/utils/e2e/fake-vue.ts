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
 * A stand-in for the parts of Vue that a generated composables file uses: `ref`, `shallowRef` and
 * `onScopeDispose`. A ref is an object with a `value`; `writes` counts what is assigned to the
 * refs, so a test can tell a write from one that the composable skipped. `run` calls a setup
 * function in an effect scope, like a component does, and `stop` disposes the scope.
 */
export function createFakeVue() {
   const stats = { writes: 0 };
   let activeScope: Array<() => void> | undefined;

   const makeRef = <T>(initial: T) => {
      let current = initial;
      return {
         get value() {
            return current;
         },
         set value(next: T) {
            stats.writes++;
            current = next;
         },
      };
   };

   const vue = {
      ref: makeRef,
      shallowRef: makeRef,
      onScopeDispose(callback: () => void) {
         if (!activeScope) {
            throw new Error("onScopeDispose was called outside of an effect scope.");
         }
         activeScope.push(callback);
      },
   };

   /** Runs `setup` in a new effect scope, and returns its result with the way to dispose the scope. */
   function run<T>(setup: () => T) {
      const disposers: Array<() => void> = [];
      activeScope = disposers;
      let result: T;
      try {
         result = setup();
      } finally {
         activeScope = undefined;
      }
      let stopped = false;
      return {
         result,
         stop() {
            if (!stopped) {
               stopped = true;
               for (const dispose of disposers) {
                  dispose();
               }
            }
         },
      };
   }

   return { vue, run, stats };
}
