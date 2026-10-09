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

import { cleanupRuntime, loadPreload, wire } from "@testutils/runtime-main-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanupRuntime);

describe("generated preload script", () => {
   describe("many subscriptions to one channel", () => {
      /** Backs the fake with a real emitter, which counts the listeners as Electron does. */
      async function loadWithEmitter() {
         const { EventEmitter } = await import("node:events");
         const emitter = new EventEmitter();
         const loaded = await loadPreload("all-kinds");
         Object.assign(loaded.electron.ipcRenderer, {
            on: emitter.on.bind(emitter),
            once: emitter.once.bind(emitter),
            removeListener: emitter.removeListener.bind(emitter),
         });
         return {
            ...loaded,
            emitter,
            send: (...args: unknown[]) => emitter.emit(wire("progress"), {}, ...args),
         };
      }

      it("adds one ipcRenderer listener however many subscribers there are", async () => {
         const { exposed, emitter, send } = await loadWithEmitter();
         const warnings: string[] = [];
         const onWarning = (warning: Error) => warnings.push(warning.name);
         process.on("warning", onWarning);
         try {
            const calls = Array.from({ length: 15 }, () => vi.fn());
            const disposers = calls.map((call, n) =>
               n % 2 === 0 ? exposed.ipc.progress.on(call) : exposed.ipc.progress.once(call),
            );
            expect(emitter.listenerCount(wire("progress"))).toBe(1);

            send(1, "a");
            await new Promise((resolve) => setImmediate(resolve));

            for (const call of calls) {
               expect(call).toHaveBeenCalledExactlyOnceWith(1, "a");
            }
            // The once subscribers are used up, the others stay.
            expect(emitter.listenerCount(wire("progress"))).toBe(1);
            for (const dispose of disposers) {
               dispose();
            }
            expect(emitter.listenerCount(wire("progress"))).toBe(0);
            expect(warnings).toStrictEqual([]);
         } finally {
            process.off("warning", onWarning);
         }
      });

      it("calls the subscribers in the order they subscribed", async () => {
         const { exposed, send } = await loadWithEmitter();
         const order: string[] = [];
         exposed.ipc.progress.on(() => order.push("on 1"));
         exposed.ipc.progress.once(() => order.push("once 2"));
         exposed.ipc.progress.on(() => order.push("on 3"));

         send(1);
         send(2);

         expect(order).toStrictEqual(["on 1", "once 2", "on 3", "on 1", "on 3"]);
      });

      it("does not call a subscriber that a callback disposed during the dispatch", async () => {
         const { exposed, emitter, send } = await loadWithEmitter();
         const order: string[] = [];
         let disposeSecond: () => void = () => undefined;
         exposed.ipc.progress.on(() => {
            order.push("first");
            disposeSecond();
         });
         disposeSecond = exposed.ipc.progress.on(() => order.push("second"));
         exposed.ipc.progress.on(() => order.push("third"));

         send(1);
         send(2);

         expect(order).toStrictEqual(["first", "third", "first", "third"]);
         expect(emitter.listenerCount(wire("progress"))).toBe(1);
      });

      it("lets a callback dispose the last subscriber, and subscribe again later", async () => {
         const { exposed, emitter, send } = await loadWithEmitter();
         const calls: string[] = [];
         let dispose: () => void = () => undefined;
         dispose = exposed.ipc.progress.on(() => {
            calls.push("only");
            dispose();
         });

         send(1);
         expect(emitter.listenerCount(wire("progress"))).toBe(0);
         send(2);
         exposed.ipc.progress.on(() => calls.push("again"));
         send(3);

         expect(calls).toStrictEqual(["only", "again"]);
         expect(emitter.listenerCount(wire("progress"))).toBe(1);
      });

      it("hands a message to a subscriber that is added during a dispatch only the next time", async () => {
         const { exposed, send } = await loadWithEmitter();
         const calls: string[] = [];
         let added = false;
         exposed.ipc.progress.on((n: number) => {
            calls.push(`outer ${n}`);
            if (!added) {
               added = true;
               exposed.ipc.progress.on((m: number) => calls.push(`inner ${m}`));
            }
         });

         send(1);
         send(2);

         expect(calls).toStrictEqual(["outer 1", "outer 2", "inner 2"]);
      });

      it("removes a once subscriber before it runs, so that it is not called again by a message it causes", async () => {
         const { exposed, send } = await loadWithEmitter();
         const calls: number[] = [];
         exposed.ipc.progress.once((n: number) => {
            calls.push(n);
            if (n < 3) {
               send(n + 1);
            }
         });

         send(1);

         expect(calls).toStrictEqual([1]);
      });

      it("logs a callback which throws, and still calls the others", async () => {
         const { exposed, send } = await loadWithEmitter();
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         const failure = new Error("page code failed");
         const after = vi.fn();
         exposed.ipc.progress.on(() => {
            throw failure;
         });
         exposed.ipc.progress.on(after);

         expect(() => send(1)).not.toThrow();

         expect(error).toHaveBeenCalledExactlyOnceWith(failure);
         expect(after).toHaveBeenCalledWith(1);
         error.mockRestore();
      });

      it("keeps the channels apart, and disposes a subscription only once", async () => {
         const { exposed, emitter, send } = await loadWithEmitter();
         const progress = vi.fn();
         const other = vi.fn();
         const dispose = exposed.ipc.progress.on(progress);
         exposed.ipc.progress.on(progress);
         exposed.ipc.titleChanged.on(other);

         dispose();
         dispose();
         send(1);

         expect(progress).toHaveBeenCalledTimes(1);
         expect(other).not.toHaveBeenCalled();
         expect(emitter.listenerCount(wire("progress"))).toBe(1);
         expect(emitter.listenerCount(wire("titleChanged"))).toBe(1);
      });
   });
});
