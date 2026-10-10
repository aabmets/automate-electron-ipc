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

type Cleanup = (() => void) | undefined;

interface EffectSlot {
   deps: readonly unknown[] | undefined;
   cleanup: Cleanup;
}

/** One hook call of a component: a state, a ref, a memo or an effect, in the order of the calls. */
type Slot =
   | { kind: "state"; value: unknown }
   | { kind: "ref"; ref: { current: unknown } }
   | { kind: "memo"; value: unknown; deps: readonly unknown[] }
   | ({ kind: "effect" } & EffectSlot);

/** The effects that a render queued, which run once it is committed. */
interface PendingEffect {
   slot: EffectSlot;
   run: () => Cleanup;
}

const sameDeps = (a: readonly unknown[], b: readonly unknown[]) =>
   a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

/**
 * A stand-in for the hooks of React that a generated hooks file uses: `useState`, `useRef`,
 * `useEffect` and `useCallback`. It behaves like React where the generated code relies on it:
 *  - an effect runs after the render that queued it, and again only when its dependencies changed
 *    (always, without a list);
 *  - before an effect runs again, and when the component unmounts, its cleanup runs;
 *  - the setter of a state keeps its identity, takes a value or an updater, and does nothing after
 *    the component unmounted.
 * `stateWrites` counts the calls of the setters, so a test can tell a write that was made from one
 * that the fake dropped.
 */
export function createFakeReact() {
   const slots: Slot[] = [];
   let cursor = 0;
   let mounted = false;
   let rendering = false;
   let dirty = false;
   let pending: PendingEffect[] = [];
   let render: () => void = () => undefined;
   const stats = { stateWrites: 0, renders: 0 };

   const slotAt = <K extends Slot["kind"]>(kind: K): Extract<Slot, { kind: K }> | undefined => {
      const slot = slots[cursor];
      if (slot !== undefined && slot.kind !== kind) {
         throw new Error("The hooks were called in a different order than in the last render.");
      }
      return slot as Extract<Slot, { kind: K }> | undefined;
   };

   /** Renders and commits until no state is left dirty. */
   function flush(): void {
      if (rendering || !mounted) {
         return;
      }
      do {
         dirty = false;
         rendering = true;
         cursor = 0;
         pending = [];
         try {
            stats.renders++;
            render();
         } finally {
            rendering = false;
         }
         // The cleanups of all effects that changed run before any of the new effects does.
         for (const effect of pending) {
            effect.slot.cleanup?.();
            effect.slot.cleanup = undefined;
         }
         for (const effect of pending) {
            effect.slot.cleanup = effect.run();
         }
      } while (dirty && mounted);
   }

   const react = {
      useState<S>(initial: S) {
         let slot = slotAt("state");
         if (slot === undefined) {
            slot = { kind: "state", value: initial };
            slots[cursor] = slot;
         }
         const own = slot;
         cursor++;
         const set = (next: S | ((previous: S) => S)) => {
            stats.stateWrites++;
            if (!mounted) {
               return;
            }
            own.value = typeof next === "function" ? (next as (p: S) => S)(own.value as S) : next;
            dirty = true;
            flush();
         };
         return [own.value as S, set] as const;
      },
      useRef<T>(initial: T) {
         let slot = slotAt("ref");
         if (slot === undefined) {
            slot = { kind: "ref", ref: { current: initial } };
            slots[cursor] = slot;
         }
         cursor++;
         return slot.ref as { current: T };
      },
      useCallback<F>(callback: F, deps: readonly unknown[]): F {
         const slot = slotAt("memo");
         if (slot !== undefined && sameDeps(slot.deps, deps)) {
            cursor++;
            return slot.value as F;
         }
         slots[cursor++] = { kind: "memo", value: callback, deps };
         return callback;
      },
      useEffect(effect: () => Cleanup, deps?: readonly unknown[]) {
         let slot = slotAt("effect");
         const changed =
            slot?.deps === undefined || deps === undefined || !sameDeps(slot.deps, deps);
         if (slot === undefined) {
            slot = { kind: "effect", deps, cleanup: undefined };
            slots[cursor] = slot;
         }
         slot.deps = deps;
         if (changed) {
            pending.push({ slot, run: effect });
         }
         cursor++;
      },
   };

   return {
      /** The module that the generated file gets for `react`. */
      react,
      stats,
      /**
       * Mounts a component, which is a function that calls the hooks. `rerender` renders it again
       * with the latest props, `unmount` runs the cleanups of its effects.
       */
      mount<R>(component: () => R) {
         let result: R | undefined;
         render = () => {
            result = component();
         };
         mounted = true;
         flush();
         return {
            get result(): R {
               return result as R;
            },
            rerender() {
               dirty = true;
               flush();
            },
            unmount() {
               mounted = false;
               for (const slot of slots) {
                  if (slot.kind === "effect") {
                     slot.cleanup?.();
                     slot.cleanup = undefined;
                  }
               }
            },
         };
      },
   };
}
