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

import { createFakeReact } from "@testutils/e2e/fake-react.js";
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

describe("generated React hooks, at runtime", () => {
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

   /** The hooks of the fixture, with the fake React in place of `react`. */
   async function load() {
      const project = await fixtures.run("react-hooks");
      const fake = createFakeReact();
      const hooks = loadGenerated(await project.read("hooks.react.ts"), { react: fake.react });
      return { fake, useIpcEvent: hooks.useIpcEvent, useIpcInvoke: hooks.useIpcInvoke };
   }

   describe("useIpcEvent", () => {
      it("subscribes to the channel once, and passes the arguments of an event on", async () => {
         const { fake, useIpcEvent } = await load();
         const callback = vi.fn();

         fake.mount(() => useIpcEvent("moved", callback));
         ipc.emit("moved", 3, 4);

         expect(ipc.subscribe).toHaveBeenCalledOnce();
         expect(callback).toHaveBeenCalledExactlyOnceWith(3, 4);
      });

      it("unsubscribes when the component unmounts", async () => {
         const { fake, useIpcEvent } = await load();
         const callback = vi.fn();
         const component = fake.mount(() => useIpcEvent("moved", callback));
         expect(ipc.listenerCount("moved")).toBe(1);

         component.unmount();
         ipc.emit("moved", 1, 2);

         expect(ipc.listenerCount("moved")).toBe(0);
         expect(callback).not.toHaveBeenCalled();
      });

      it("keeps the subscription when the callback changes, and calls the latest callback", async () => {
         const { fake, useIpcEvent } = await load();
         const first = vi.fn();
         const second = vi.fn();
         let callback = first;
         const component = fake.mount(() => useIpcEvent("moved", callback));

         callback = second;
         component.rerender();
         ipc.emit("moved", 5, 6);

         expect(ipc.subscribe).toHaveBeenCalledOnce();
         expect(first).not.toHaveBeenCalled();
         expect(second).toHaveBeenCalledExactlyOnceWith(5, 6);
      });

      it("moves the subscription when the name changes", async () => {
         const { fake, useIpcEvent } = await load();
         const callback = vi.fn();
         let name = "moved";
         const component = fake.mount(() => useIpcEvent(name, callback));

         name = "titleChanged";
         component.rerender();

         expect(ipc.listenerCount("moved")).toBe(0);
         expect(ipc.listenerCount("titleChanged")).toBe(1);
         ipc.emit("moved", 1, 2);
         ipc.emit("titleChanged", "hello");
         expect(callback).toHaveBeenCalledExactlyOnceWith("hello");
      });
   });

   describe("useIpcInvoke", () => {
      it("starts idle, is pending during a call, and holds the result afterwards", async () => {
         const { fake, useIpcInvoke } = await load();
         const call = deferred<{ id: number }>();
         ipc.api.getUser.invoke.mockReturnValue(call.promise);
         const component = fake.mount(() => useIpcInvoke("getUser"));
         expect(component.result).toMatchObject({
            data: undefined,
            error: undefined,
            pending: false,
         });

         const result = component.result.invoke(7);

         expect(ipc.api.getUser.invoke).toHaveBeenCalledExactlyOnceWith(7);
         expect(component.result.pending).toBe(true);
         call.resolve({ id: 7 });
         await expect(result).resolves.toStrictEqual({ id: 7 });
         expect(component.result).toMatchObject({
            data: { id: 7 },
            error: undefined,
            pending: false,
         });
      });

      it("rejects with the error, and holds it, while the data of the last result stays", async () => {
         const { fake, useIpcInvoke } = await load();
         ipc.api.sum.invoke.mockResolvedValueOnce(3);
         const failure = { name: "Error", message: "boom" };
         ipc.api.sum.invoke.mockRejectedValueOnce(failure);
         const component = fake.mount(() => useIpcInvoke("sum"));
         await component.result.invoke(1, 2);

         await expect(component.result.invoke(1, 2)).rejects.toBe(failure);

         expect(component.result).toMatchObject({ data: 3, error: failure, pending: false });
      });

      it("clears the error when the next call starts", async () => {
         const { fake, useIpcInvoke } = await load();
         ipc.api.sum.invoke.mockRejectedValueOnce(new Error("boom"));
         const call = deferred<number>();
         ipc.api.sum.invoke.mockReturnValueOnce(call.promise);
         const component = fake.mount(() => useIpcInvoke("sum"));
         await component.result.invoke(1, 2).catch(() => undefined);
         expect(component.result.error).toBeInstanceOf(Error);

         const next = component.result.invoke(1, 2);

         expect(component.result).toMatchObject({ error: undefined, pending: true });
         call.resolve(3);
         await next;
      });

      it("ignores the result of a call that a newer call has replaced", async () => {
         const { fake, useIpcInvoke } = await load();
         const slow = deferred<number>();
         const fast = deferred<number>();
         ipc.api.sum.invoke.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
         const component = fake.mount(() => useIpcInvoke("sum"));

         const first = component.result.invoke(1, 1);
         const second = component.result.invoke(2, 2);
         fast.resolve(4);
         await second;
         slow.resolve(2);

         // The old call still resolves for its caller, but it does not change the state.
         await expect(first).resolves.toBe(2);
         expect(component.result).toMatchObject({ data: 4, pending: false });
      });

      it("keeps the pending state while the newest call runs, when an older call fails", async () => {
         const { fake, useIpcInvoke } = await load();
         const slow = deferred<number>();
         const fast = deferred<number>();
         ipc.api.sum.invoke.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
         const component = fake.mount(() => useIpcInvoke("sum"));
         const first = component.result.invoke(1, 1);
         const second = component.result.invoke(2, 2);

         slow.reject(new Error("late"));
         await expect(first).rejects.toThrow("late");

         expect(component.result).toMatchObject({ error: undefined, pending: true });
         fast.resolve(4);
         await second;
      });

      it("does not write the state of a call that finishes after the component unmounted", async () => {
         const { fake, useIpcInvoke } = await load();
         const call = deferred<number>();
         ipc.api.sum.invoke.mockReturnValueOnce(call.promise);
         const component = fake.mount(() => useIpcInvoke("sum"));
         const result = component.result.invoke(1, 1);
         const writesBefore = fake.stats.stateWrites;

         component.unmount();
         call.resolve(2);

         await expect(result).resolves.toBe(2);
         expect(fake.stats.stateWrites).toBe(writesBefore);
      });

      it("does not write the error of a call that fails after the component unmounted", async () => {
         const { fake, useIpcInvoke } = await load();
         const call = deferred<number>();
         ipc.api.sum.invoke.mockReturnValueOnce(call.promise);
         const component = fake.mount(() => useIpcInvoke("sum"));
         const result = component.result.invoke(1, 1);
         const writesBefore = fake.stats.stateWrites;

         component.unmount();
         call.reject(new Error("late"));

         await expect(result).rejects.toThrow("late");
         expect(fake.stats.stateWrites).toBe(writesBefore);
      });

      it("keeps the identity of invoke between renders, and changes it with the name", async () => {
         const { fake, useIpcInvoke } = await load();
         let name = "sum";
         const component = fake.mount(() => useIpcInvoke(name));
         const { invoke } = component.result;

         component.rerender();
         expect(component.result.invoke).toBe(invoke);

         name = "getUser";
         component.rerender();
         expect(component.result.invoke).not.toBe(invoke);
      });
   });
});
