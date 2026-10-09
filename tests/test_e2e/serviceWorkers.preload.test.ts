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
   createFakePreloadElectron,
   loadGenerated,
} from "@testutils/runtime-utils.js";
import { failed, flush, ok, wire } from "@testutils/service-worker-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
});

describe("service worker channels, preload script", () => {
   async function loadPreload(fixture = "service-worker-channels") {
      project = await runFixture(fixture);
      const fakeElectron = createFakePreloadElectron();
      const ipcRenderer = fakeElectron.electron.ipcRenderer as Record<
         string,
         ReturnType<typeof vi.fn>
      >;
      const exports = loadGenerated(project.generated["service-worker-preload.ts"] as string, {
         electron: fakeElectron.electron,
      });
      /** The listener that the script registered with `ipcRenderer.on` for the wire name. */
      const listenerFor = (channel: string) =>
         ipcRenderer.on.mock.calls.find((call) => call[0] === wire(channel))?.[1] as (
            ...args: unknown[]
         ) => void;
      return { ...fakeElectron, exports, ipcRenderer, listenerFor };
   }

   it("exposes the API of the worker under the key of the config, in the main world", async () => {
      const { exposed, exports, electron } = await loadPreload();

      expect(Object.keys(exposed)).toStrictEqual(["ipc"]);
      expect(exposed.ipc).toStrictEqual(exports.api);
      expect(electron.contextBridge.exposeInIsolatedWorld).not.toHaveBeenCalled();
      expect(callablePaths(exposed.ipc)).toStrictEqual([
         "configChanged.on",
         "configChanged.once",
         "describe.handle",
         "echo.invoke",
         "flushQueue.handle",
         "getToken.invoke",
         "goOffline.on",
         "goOffline.once",
         "log.send",
         "saveBlob.invoke",
         "syncDone.send",
      ]);
   });

   it("calls the main process with ipcRenderer.invoke, and unwraps the envelope", async () => {
      const { exposed, ipcRenderer } = await loadPreload();
      ipcRenderer.invoke.mockResolvedValueOnce(ok({ value: "t", expires: 1 }));

      expect(await exposed.ipc.getToken.invoke("app", true)).toStrictEqual({
         value: "t",
         expires: 1,
      });
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(wire("getToken"), "app", true);

      const error = { name: "NotSignedInError", message: "no", code: "NOT_SIGNED_IN" };
      ipcRenderer.invoke.mockResolvedValueOnce(failed(error));
      await expect(exposed.ipc.getToken.invoke("app")).rejects.toBe(error);
   });

   it("sends with ipcRenderer.send", async () => {
      const { exposed, ipcRenderer } = await loadPreload();

      exposed.ipc.syncDone.send({ pending: 1 });
      exposed.ipc.log.send("info", "text");

      expect(ipcRenderer.send.mock.calls).toStrictEqual([
         [wire("syncDone"), { pending: 1 }],
         [wire("log"), "info", "text"],
      ]);
   });

   it("subscribes to the messages of the main process, and returns a disposer for each listener", async () => {
      const { exposed, ipcRenderer } = await loadPreload();
      const callback = vi.fn();

      const off = exposed.ipc.configChanged.on(callback);
      const registered = ipcRenderer.on.mock.calls.filter(
         (call) => call[0] === wire("configChanged"),
      );
      expect(registered).toHaveLength(1);
      registered[0][1]({ sender: "ignored" }, "theme", 1);
      expect(callback).toHaveBeenCalledWith("theme", 1);

      off();
      expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
         wire("configChanged"),
         registered[0][1],
      );
      exposed.ipc.goOffline.once(callback);
      // A once subscription shares the listener of its channel, and does not use ipcRenderer.once.
      expect(ipcRenderer.on).toHaveBeenCalledWith(wire("goOffline"), expect.any(Function));
      expect(ipcRenderer.once).not.toHaveBeenCalled();
   });

   describe("the responders to the questions of the main process", () => {
      it("answers on the reply channel with the ID and the envelope", async () => {
         const { exposed, ipcRenderer, listenerFor } = await loadPreload();
         const responder = vi.fn(async (force: boolean) => (force ? 7 : 0));
         exposed.ipc.flushQueue.handle(responder);

         listenerFor("flushQueue")({}, 42, true);
         await flush();

         expect(responder).toHaveBeenCalledWith(true);
         expect(ipcRenderer.send).toHaveBeenCalledWith(wire("flushQueue:reply"), 42, ok(7));
      });

      it("answers with IPC_ASK_NO_HANDLER while there is no responder", async () => {
         const { ipcRenderer, listenerFor } = await loadPreload();

         listenerFor("describe")({}, 1);
         await flush();

         expect(ipcRenderer.send).toHaveBeenCalledWith(
            wire("describe:reply"),
            1,
            failed({
               name: "IpcAskError",
               message: "No handler is registered for the channel 'describe'",
               code: "IPC_ASK_NO_HANDLER",
            }),
         );
      });

      it("answers with the fields of an error that the responder throws", async () => {
         const { exposed, ipcRenderer, listenerFor } = await loadPreload();
         exposed.ipc.flushQueue.handle(() =>
            Promise.reject({
               name: "FlushError",
               message: "locked",
               code: "LOCKED",
               data: { n: 1 },
            }),
         );

         listenerFor("flushQueue")({}, 3, false);
         await flush();

         expect(ipcRenderer.send).toHaveBeenCalledWith(
            wire("flushQueue:reply"),
            3,
            failed({ name: "FlushError", message: "locked", code: "LOCKED", data: { n: 1 } }),
         );
      });

      it("replaces the responder with a new one, and removes only its own with a disposer", async () => {
         const { exposed, ipcRenderer, listenerFor } = await loadPreload();
         const first = exposed.ipc.flushQueue.handle(() => 1);
         const second = exposed.ipc.flushQueue.handle(() => 2);
         first();

         listenerFor("flushQueue")({}, 1, true);
         await flush();
         expect(ipcRenderer.send).toHaveBeenLastCalledWith(wire("flushQueue:reply"), 1, ok(2));

         second();
         listenerFor("flushQueue")({}, 2, true);
         await flush();
         expect(ipcRenderer.send.mock.lastCall?.[2].error.code).toBe("IPC_ASK_NO_HANDLER");
      });

      it("replaces an answer that cannot be sent with an error", async () => {
         const { exposed, ipcRenderer, listenerFor } = await loadPreload();
         exposed.ipc.flushQueue.handle(() => 1);
         ipcRenderer.send.mockImplementationOnce(() => {
            throw new Error("An object could not be cloned");
         });

         listenerFor("flushQueue")({}, 5, true);
         await flush();

         expect(ipcRenderer.send).toHaveBeenLastCalledWith(
            wire("flushQueue:reply"),
            5,
            failed({
               name: "IpcAskError",
               message:
                  "The answer of the channel 'flushQueue' cannot be sent: An object could not be cloned",
               code: "IPC_ASK_UNSENDABLE",
            }),
         );
      });
   });

   it("uses the channel prefix of the config on every wire name", async () => {
      project = await runFixture("service-worker-prefix");
      const source = project.generated["service-worker-preload.ts"] as string;
      expect(source).toContain("'worker/getToken'");
      expect(source).toContain("'worker/flushQueue:reply'");
      expect(source).not.toContain("autoipc:");
      const mainSource = project.generated["main.ts"];
      expect(mainSource).toContain("wire: 'worker/getToken'");
      expect(mainSource).toContain("wire: 'worker/flushQueue:reply'");
   });
});
