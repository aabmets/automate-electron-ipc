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

import { createFakeVue } from "@testutils/e2e/fake-vue.js";
import { loadGenerated } from "@testutils/e2e/runtime-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A promise that the test settles when it chooses, to stage the end of a call. */
function deferred<T>() {
   let resolve!: (value: T) => void;
   let reject!: (reason: unknown) => void;
   const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
   });
   return { promise, resolve, reject };
}

/** The fake `ipc` of the page: event channels with listener sets, and invoke channels as spies. */
function createFakeIpc() {
   const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
   const subscribe = vi.fn((name: string, callback: (...args: unknown[]) => void) => {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(callback);
      return () => set.delete(callback);
   });
   const channel = (name: string) => ({
      on: (callback: (...args: unknown[]) => void) => subscribe(name, callback),
      once: vi.fn(),
   });
   return {
      subscribe,
      listenerCount: (name: string) => listeners.get(name)?.size ?? 0,
      emit: (name: string, ...args: unknown[]) => {
         for (const callback of [...(listeners.get(name) ?? [])]) {
            callback(...args);
         }
      },
      api: {
         titleChanged: channel("titleChanged"),
         moved: channel("moved"),
         getUser: { invoke: vi.fn() },
         sum: { invoke: vi.fn() },
      },
   };
}

describe("generated Vue composables, at runtime", () => {
   let ipc: ReturnType<typeof createFakeIpc>;
   let previous: unknown;

   beforeEach(() => {
      ipc = createFakeIpc();
      previous = (globalThis as Record<string, unknown>).ipc;
      (globalThis as Record<string, unknown>).ipc = ipc.api;
   });
   afterEach(() => {
      (globalThis as Record<string, unknown>).ipc = previous;
   });

   /** The composables of the fixture, with the fake Vue in place of `vue`. */
   async function load() {
      const project = await fixtures.run("vue-hooks");
      const fake = createFakeVue();
      const hooks = loadGenerated(await project.read("hooks.vue.ts"), { vue: fake.vue });
      return { fake, useIpcEvent: hooks.useIpcEvent, useIpcInvoke: hooks.useIpcInvoke };
   }

   describe("useIpcEvent", () => {
      it("subscribes at once, and passes the arguments of an event on", async () => {
         const { fake, useIpcEvent } = await load();
         const callback = vi.fn();

         fake.run(() => useIpcEvent("moved", callback));

         expect(ipc.subscribe).toHaveBeenCalledOnce();
         ipc.emit("moved", 3, 4);
         expect(callback).toHaveBeenCalledExactlyOnceWith(3, 4);
      });

      it("unsubscribes when the scope is disposed, and only then", async () => {
         const { fake, useIpcEvent } = await load();
         const callback = vi.fn();
         const scope = fake.run(() => useIpcEvent("moved", callback));
         expect(ipc.listenerCount("moved")).toBe(1);

         scope.stop();
         ipc.emit("moved", 1, 2);

         expect(ipc.listenerCount("moved")).toBe(0);
         expect(callback).not.toHaveBeenCalled();
      });

      it("keeps one subscription for each call, in the scope of its own", async () => {
         const { fake, useIpcEvent } = await load();
         const first = vi.fn();
         const second = vi.fn();
         const one = fake.run(() => useIpcEvent("titleChanged", first));
         fake.run(() => useIpcEvent("titleChanged", second));

         one.stop();
         ipc.emit("titleChanged", "hello");

         expect(first).not.toHaveBeenCalled();
         expect(second).toHaveBeenCalledExactlyOnceWith("hello");
      });
   });

   describe("useIpcInvoke", () => {
      it("starts idle, is pending during a call, and holds the result afterwards", async () => {
         const { fake, useIpcInvoke } = await load();
         const call = deferred<{ id: number }>();
         ipc.api.getUser.invoke.mockReturnValue(call.promise);
         const { result } = fake.run(() => useIpcInvoke("getUser"));
         expect(result.data.value).toBeUndefined();
         expect(result.error.value).toBeUndefined();
         expect(result.pending.value).toBe(false);

         const pending = result.invoke(7);

         expect(ipc.api.getUser.invoke).toHaveBeenCalledExactlyOnceWith(7);
         expect(result.pending.value).toBe(true);
         call.resolve({ id: 7 });
         await expect(pending).resolves.toStrictEqual({ id: 7 });
         expect(result.data.value).toStrictEqual({ id: 7 });
         expect(result.error.value).toBeUndefined();
         expect(result.pending.value).toBe(false);
      });

      it("rejects with the error, and holds it, while the data of the last result stays", async () => {
         const { fake, useIpcInvoke } = await load();
         ipc.api.sum.invoke.mockResolvedValueOnce(3);
         const failure = { name: "Error", message: "boom" };
         ipc.api.sum.invoke.mockRejectedValueOnce(failure);
         const { result } = fake.run(() => useIpcInvoke("sum"));
         await result.invoke(1, 2);

         await expect(result.invoke(1, 2)).rejects.toBe(failure);

         expect(result.data.value).toBe(3);
         expect(result.error.value).toBe(failure);
         expect(result.pending.value).toBe(false);
      });

      it("clears the error when the next call starts", async () => {
         const { fake, useIpcInvoke } = await load();
         ipc.api.sum.invoke.mockRejectedValueOnce(new Error("boom"));
         const call = deferred<number>();
         ipc.api.sum.invoke.mockReturnValueOnce(call.promise);
         const { result } = fake.run(() => useIpcInvoke("sum"));
         await result.invoke(1, 2).catch(() => undefined);
         expect(result.error.value).toBeInstanceOf(Error);

         const next = result.invoke(1, 2);

         expect(result.error.value).toBeUndefined();
         expect(result.pending.value).toBe(true);
         call.resolve(3);
         await next;
      });

      it("ignores the result of a call that a newer call has replaced", async () => {
         const { fake, useIpcInvoke } = await load();
         const slow = deferred<number>();
         const fast = deferred<number>();
         ipc.api.sum.invoke.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
         const { result } = fake.run(() => useIpcInvoke("sum"));

         const first = result.invoke(1, 1);
         const second = result.invoke(2, 2);
         fast.resolve(4);
         await second;
         slow.resolve(2);

         // The old call still resolves for its caller, but it does not change the state.
         await expect(first).resolves.toBe(2);
         expect(result.data.value).toBe(4);
         expect(result.pending.value).toBe(false);
      });

      it("keeps the pending state while the newest call runs, when an older call fails", async () => {
         const { fake, useIpcInvoke } = await load();
         const slow = deferred<number>();
         const fast = deferred<number>();
         ipc.api.sum.invoke.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
         const { result } = fake.run(() => useIpcInvoke("sum"));
         const first = result.invoke(1, 1);
         const second = result.invoke(2, 2);

         slow.reject(new Error("late"));
         await expect(first).rejects.toThrow("late");

         expect(result.error.value).toBeUndefined();
         expect(result.pending.value).toBe(true);
         fast.resolve(4);
         await second;
      });

      it("does not write the state of a call that finishes after the scope was disposed", async () => {
         const { fake, useIpcInvoke } = await load();
         const call = deferred<number>();
         ipc.api.sum.invoke.mockReturnValueOnce(call.promise);
         const scope = fake.run(() => useIpcInvoke("sum"));
         const result = scope.result.invoke(1, 1);
         const writesBefore = fake.stats.writes;

         scope.stop();
         call.resolve(2);

         await expect(result).resolves.toBe(2);
         expect(fake.stats.writes).toBe(writesBefore);
      });

      it("does not write the error of a call that fails after the scope was disposed", async () => {
         const { fake, useIpcInvoke } = await load();
         const call = deferred<number>();
         ipc.api.sum.invoke.mockReturnValueOnce(call.promise);
         const scope = fake.run(() => useIpcInvoke("sum"));
         const result = scope.result.invoke(1, 1);
         const writesBefore = fake.stats.writes;

         scope.stop();
         call.reject(new Error("late"));

         await expect(result).rejects.toThrow("late");
         expect(fake.stats.writes).toBe(writesBefore);
      });

      it("keeps the state of one call apart from the state of another", async () => {
         const { fake, useIpcInvoke } = await load();
         ipc.api.sum.invoke.mockResolvedValue(3);
         ipc.api.getUser.invoke.mockResolvedValue({ id: 1 });
         const { result: sum } = fake.run(() => useIpcInvoke("sum"));
         const { result: user } = fake.run(() => useIpcInvoke("getUser"));

         await sum.invoke(1, 2);

         expect(sum.data.value).toBe(3);
         expect(user.data.value).toBeUndefined();
         expect(user.pending.value).toBe(false);
      });
   });
});
