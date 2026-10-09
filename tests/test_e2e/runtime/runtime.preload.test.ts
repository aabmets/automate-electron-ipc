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

import { loadPreload } from "@testutils/e2e/runtime-main-utils.js";
import { callablePaths, windowIpcPaths } from "@testutils/e2e/runtime-utils.js";
import { wire } from "@testutils/e2e/wire-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { describe, expect, it, vi } from "vitest";

describe("fixture all-kinds", () => {
   it("generates files that type-check", async () => {
      const project = await fixtures.run("all-kinds");
      expect(await project.typecheck()).toBe("");
   });
});

describe("generated preload script", () => {
   it.each(["all-kinds", "triggers", "param-shapes", "port-only", "handler-types"])(
      "exposes exactly the members that the generated IpcApi declares (%s)",
      async (fixture) => {
         const { exposed, project } = await loadPreload(fixture);
         expect(Object.keys(exposed)).toStrictEqual(["ipc"]);
         const declared = windowIpcPaths(project.generated["window.d.ts"]);
         expect(declared.length).toBeGreaterThan(0);
         expect(callablePaths(exposed.ipc)).toStrictEqual(declared);
      },
   );

   it("exposes one object per channel, with only the methods of its verb", async () => {
      const { exposed } = await loadPreload("all-kinds");

      expect(callablePaths(exposed.ipc)).toStrictEqual([
         "chat.on",
         "chat.onClose",
         "chat.onConnection",
         "chat.onOverflow",
         "chat.onReady",
         "chat.send",
         "getTime.invoke",
         "getUser.invoke",
         "logLine.send",
         "progress.on",
         "progress.once",
         "titleChanged.on",
         "titleChanged.once",
      ]);
   });

   it("exposes nothing but an empty api, and declares nothing, when there are no channels", async () => {
      const { exposed, project } = await loadPreload("no-channels");
      expect(callablePaths(exposed.ipc)).toStrictEqual([]);
      expect(windowIpcPaths(project.generated["window.d.ts"])).toStrictEqual([]);
   });

   it("forwards invoke channels to ipcRenderer.invoke and returns its promise", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");
      electron.ipcRenderer.invoke.mockResolvedValue({ ok: true, value: "Ann" });

      await expect(exposed.ipc.getUser.invoke(7)).resolves.toBe("Ann");
      expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(wire("getUser"), 7);
      await exposed.ipc.getTime.invoke();
      expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith(wire("getTime"));
   });

   it("forwards send channels to ipcRenderer.send, spreading rest arguments", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");

      exposed.ipc.logLine.send("line", 1, 2);

      expect(electron.ipcRenderer.send).toHaveBeenCalledWith(wire("logLine"), "line", 1, 2);
   });

   it("registers listeners which receive the arguments without the event", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");
      const callback = vi.fn();

      exposed.ipc.progress.on(callback);

      const [channel, listener] = electron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === wire("progress"),
      ) as [string, (...args: unknown[]) => void];
      expect(channel).toBe(wire("progress"));
      listener({ sender: "event" }, 50, "half");
      expect(callback).toHaveBeenCalledWith(50, "half");
   });

   it("returns a function which removes only that subscription, and not ipcRenderer", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");
      const { ipcRenderer } = electron;
      const first = vi.fn();
      const second = vi.fn();

      const dispose = exposed.ipc.progress.on(first);
      const disposeSecond = exposed.ipc.progress.on(second);

      expect(typeof dispose).toBe("function");
      expect(dispose).not.toBe(ipcRenderer);
      // The subscriptions of a channel share one listener of ipcRenderer (T94).
      const listeners = ipcRenderer.on.mock.calls
         .filter(([name]: [string]) => name === wire("progress"))
         .map(([, listener]: [string, (...args: unknown[]) => void]) => listener);
      expect(listeners).toHaveLength(1);

      expect(dispose()).toBeUndefined();
      expect(ipcRenderer.removeListener).not.toHaveBeenCalled();
      listeners[0]({}, 1);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith(1);

      disposeSecond();
      expect(ipcRenderer.removeListener).toHaveBeenCalledTimes(1);
      expect(ipcRenderer.removeListener).toHaveBeenCalledWith(wire("progress"), listeners[0]);
   });

   it("stops delivering to a disposed listener, as ipcRenderer does after removeListener", async () => {
      // Back the fake with a real emitter, so that the removal is observable.
      const { EventEmitter } = await import("node:events");
      const emitter = new EventEmitter();
      const { exposed, electron } = await loadPreload("all-kinds");
      Object.assign(electron.ipcRenderer, {
         on: emitter.on.bind(emitter),
         once: emitter.once.bind(emitter),
         removeListener: emitter.removeListener.bind(emitter),
      });
      const callback = vi.fn();

      const dispose = exposed.ipc.progress.on(callback);
      emitter.emit(wire("progress"), {}, 1);
      dispose();
      emitter.emit(wire("progress"), {}, 2);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(1);
      expect(emitter.listenerCount(wire("progress"))).toBe(0);
   });

   it("once delivers a single message without the event, and can be disposed before it", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");
      const callback = vi.fn();

      const dispose = exposed.ipc.progress.once(callback);

      const [channel, listener] = electron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === wire("progress"),
      ) as [string, (...args: unknown[]) => void];
      expect(channel).toBe(wire("progress"));
      expect(electron.ipcRenderer.once).not.toHaveBeenCalled();
      listener({ sender: "event" }, 5, "x");
      expect(callback).toHaveBeenCalledWith(5, "x");
      // The only subscriber is used up, so the listener of ipcRenderer is gone as well.
      expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(wire("progress"), listener);
      listener({ sender: "event" }, 6, "y");
      expect(callback).toHaveBeenCalledTimes(1);

      expect(dispose()).toBeUndefined();
      expect(electron.ipcRenderer.removeListener).toHaveBeenCalledTimes(1);
   });

   it("disposes a once subscription before its message", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");
      const callback = vi.fn();

      const dispose = exposed.ipc.progress.once(callback);
      dispose();

      const [, listener] = electron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === wire("progress"),
      ) as [string, (...args: unknown[]) => void];
      expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(wire("progress"), listener);
      listener({}, 1);
      expect(callback).not.toHaveBeenCalled();
   });

   it("stores the port of a port channel and posts and receives messages through it", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");
      const port = {
         postMessage: vi.fn(),
         close: vi.fn(),
         addEventListener: vi.fn(),
         onmessage: undefined as ((event: unknown) => void) | undefined,
      };
      const [, onPort] = electron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === wire("chat"),
      ) as [string, (event: unknown, key: unknown) => void];

      onPort({ ports: [port] }, "1:a");
      exposed.ipc.chat.send("hi", 1);
      expect(port.postMessage).toHaveBeenCalledWith(["hi", 1]);

      const callback = vi.fn();
      exposed.ipc.chat.on(callback);
      port.onmessage?.({ data: ["there", 2] });
      expect(callback).toHaveBeenCalledWith("there", 2);
   });
});
