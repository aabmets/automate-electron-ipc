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

import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import {
   callablePaths,
   createFakeElectron,
   createFakePreloadElectron,
   createFakeWindow,
   loadGenerated,
   windowIpcPaths,
} from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   await project?.cleanup();
   project = undefined;
});

/** Runs the generated preload script against a fake contextBridge and ipcRenderer. */
async function loadPreload(fixture: string) {
   project = await runFixture(fixture);
   const fake = createFakePreloadElectron();
   loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
   return { ...fake, project };
}

describe("fixture all-kinds", () => {
   it("generates files that type-check", async () => {
      project = await runFixture("all-kinds");
      expect(await project.typecheck()).toBe("");
   });
});

describe("generated preload script", () => {
   it.each(["all-kinds", "triggers", "param-shapes", "port-only", "handler-types"])(
      "exposes exactly the members that Window.ipc declares (%s)",
      async (fixture) => {
         const { exposed, project } = await loadPreload(fixture);
         expect(Object.keys(exposed)).toStrictEqual(["ipc"]);
         const declared = windowIpcPaths(project.generated["window.d.ts"]);
         expect(declared.length).toBeGreaterThan(0);
         expect(callablePaths(exposed.ipc)).toStrictEqual(declared);
      },
   );

   it("exposes nothing but an empty api, and declares nothing, when there are no channels", async () => {
      const { exposed, project } = await loadPreload("no-channels");
      expect(callablePaths(exposed.ipc)).toStrictEqual([]);
      expect(windowIpcPaths(project.generated["window.d.ts"])).toStrictEqual([]);
   });

   it("forwards invoke channels to ipcRenderer.invoke and returns its promise", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");
      electron.ipcRenderer.invoke.mockResolvedValue("Ann");

      await expect(exposed.ipc.sendGetUser(7)).resolves.toBe("Ann");
      expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith("getUser", 7);
      await exposed.ipc.sendGetTime();
      expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith("getTime");
   });

   it("forwards send channels to ipcRenderer.send, spreading rest arguments", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");

      exposed.ipc.sendLogLine("line", 1, 2);

      expect(electron.ipcRenderer.send).toHaveBeenCalledWith("logLine", "line", 1, 2);
   });

   it("registers listeners which receive the arguments without the event", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");
      const callback = vi.fn();

      exposed.ipc.onProgress(callback);

      const [channel, listener] = electron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === "progress",
      ) as [string, (...args: unknown[]) => void];
      expect(channel).toBe("progress");
      listener({ sender: "event" }, 50, "half");
      expect(callback).toHaveBeenCalledWith(50, "half");
   });

   it("stores the port of a port channel and posts and receives messages through it", async () => {
      const { exposed, electron } = await loadPreload("all-kinds");
      const port: { postMessage: ReturnType<typeof vi.fn>; onmessage?: (event: unknown) => void } =
         { postMessage: vi.fn() };
      const [, onPort] = electron.ipcRenderer.on.mock.calls.find(
         ([name]: [string]) => name === "chat",
      ) as [string, (event: unknown) => void];

      onPort({ ports: [port] });
      exposed.ipc.ports.chat.sendMessage("hi", 1);
      expect(port.postMessage).toHaveBeenCalledWith(["hi", 1]);

      const callback = vi.fn();
      exposed.ipc.ports.chat.onMessage(callback);
      port.onmessage?.({ data: ["there", 2] });
      expect(callback).toHaveBeenCalledWith("there", 2);
   });
});

describe("generated main process bindings", () => {
   async function loadMain() {
      project = await runFixture("all-kinds");
      class FakeChannel {
         port1 = { name: "port1" };
         port2 = { name: "port2" };
      }
      const electron = { ...createFakeElectron(), MessageChannelMain: FakeChannel };
      return {
         electron,
         ipcMain: loadGenerated(project.generated["main.ts"], { electron }).ipcMain,
      };
   }

   it("registers a handle wrapper which passes the event and arguments to the callback", async () => {
      const { electron, ipcMain } = await loadMain();
      const callback = vi.fn(async (_event: unknown, id: number) => `user ${id}`);

      ipcMain.onGetUser(callback);

      expect(electron.ipcMain.handle).toHaveBeenCalledOnce();
      const [channel, wrapper] = electron.ipcMain.handle.mock.calls[0];
      expect(channel).toBe("getUser");
      const event = { sender: "renderer" };
      await expect(wrapper(event, 3)).resolves.toBe("user 3");
      expect(callback).toHaveBeenCalledWith(event, 3);
      expect(electron.ipcMain.on).not.toHaveBeenCalled();
   });

   it("returns the rejection of the callback to the renderer through handle", async () => {
      const { electron, ipcMain } = await loadMain();
      ipcMain.onGetTime(() => Promise.reject(new Error("no clock")));

      const [, wrapper] = electron.ipcMain.handle.mock.calls[0];
      await expect(wrapper({})).rejects.toThrowError("no clock");
   });

   it("registers an on wrapper which spreads rest arguments", async () => {
      const { electron, ipcMain } = await loadMain();
      const callback = vi.fn();

      ipcMain.onLogLine(callback);

      const [channel, wrapper] = electron.ipcMain.on.mock.calls[0];
      expect(channel).toBe("logLine");
      wrapper("event", "line", 1, 2);
      expect(callback).toHaveBeenCalledWith("event", "line", 1, 2);
   });

   it("posts the two ends of a port channel to the two windows once they are ready", async () => {
      const { ipcMain } = await loadMain();
      const one = Object.assign(createFakeWindow(), { webContents: { postMessage: vi.fn() } });
      const two = Object.assign(createFakeWindow(), { webContents: { postMessage: vi.fn() } });

      ipcMain.ports.chat.propagate(one, two);
      expect(one.webContents.postMessage).not.toHaveBeenCalled();
      one.emit("ready-to-show");
      two.emit("ready-to-show");

      expect(one.webContents.postMessage).toHaveBeenCalledWith("chat", null, [{ name: "port1" }]);
      expect(two.webContents.postMessage).toHaveBeenCalledWith("chat", null, [{ name: "port2" }]);
   });
});
