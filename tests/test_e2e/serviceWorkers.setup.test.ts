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
import { windowIpcPaths } from "@testutils/runtime-utils.js";
import {
   createSession,
   createWorker,
   loadWorkerMain,
   ok,
   wire,
} from "@testutils/service-worker-utils.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
});

describe("service worker channels, files", () => {
   it("type-checks main.ts, the preload script of the worker and the code which uses them", async () => {
      project = await runFixture("service-worker-channels");
      expect(await project.typecheck()).toBe("");
      expect(await project.typecheckWorker()).toBe("");
   }, 60_000);

   it("writes the files of the worker next to the others, and leaves the page its own channels", async () => {
      project = await runFixture("service-worker-channels");
      const { generated } = project;
      expect(Object.keys(generated).sort()).toStrictEqual([
         "main.ts",
         "preload.ts",
         "service-worker-preload.ts",
         "service-worker.d.ts",
         "window.d.ts",
      ]);
      expect(windowIpcPaths(generated["window.d.ts"])).toStrictEqual(["getUser.invoke"]);
      expect(windowIpcPaths(generated["service-worker.d.ts"])).toStrictEqual([
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
      expect(generated["preload.ts"]).not.toContain("getToken");
      expect(generated["service-worker.d.ts"]).not.toContain("getUser");
   });
});

describe("service worker channels, one verb alone", () => {
   // A schema with a single verb gets only the helpers that the verb uses, so nothing is left unused.
   it.each(["emitToWorker", "sendFromWorker", "askWorker", "invokeFromWorker"])(
      "type-checks the files of a schema with only %s, also with unused locals refused",
      async (verb) => {
         project = await runFixture(`service-worker-only-${verb}`);
         const strict = { noUnusedLocals: true, noUnusedParameters: true };
         expect(await project.typecheck(strict)).toBe("");
         expect(await project.typecheckWorker(strict)).toBe("");
         expect(Object.keys(project.generated)).toContain("service-worker-preload.ts");
      },
   );
});

describe("service worker channels, main process", () => {
   let main: any;
   let fake: ReturnType<typeof createSession>;

   beforeEach(async () => {
      project = await runFixture("service-worker-channels");
      main = loadWorkerMain(project);
      fake = createSession();
   }, 60_000);

   describe("attachServiceWorkers", () => {
      it("routes the workers that run already, and the ones that start later", () => {
         const early = createWorker(1);
         fake.add(early);
         main.attachServiceWorkers(fake.session);
         const late = createWorker(2);
         fake.start(late);

         for (const one of [early, late]) {
            expect([...one.handlers.keys()].sort()).toStrictEqual([
               wire("echo"),
               wire("getToken"),
               wire("saveBlob"),
            ]);
            expect([...one.listeners.keys()].sort()).toStrictEqual([
               wire("describe:reply"),
               wire("flushQueue:reply"),
               wire("log"),
               wire("syncDone"),
            ]);
         }
      });

      it("routes a worker once, however often its status changes", () => {
         main.attachServiceWorkers(fake.session);
         const one = createWorker(1);
         fake.start(one, "starting");
         fake.status(1, "running");
         fake.status(1, "running");

         expect(one.worker.ipc.handle).toHaveBeenCalledTimes(3);
         expect(one.worker.ipc.on).toHaveBeenCalledTimes(4);
      });

      it("listens to a session once", () => {
         main.attachServiceWorkers(fake.session);
         main.attachServiceWorkers(fake.session);
         main.ipc.syncDone.on(fake.session, () => undefined);

         expect(fake.serviceWorkers.listenerCount("running-status-changed")).toBe(1);
      });

      it("keeps the hubs of two sessions apart", async () => {
         const other = createSession();
         const first = createWorker(1);
         const second = createWorker(1);
         main.ipc.getToken.handle(fake.session, () => Promise.resolve("first"));
         main.ipc.getToken.handle(other.session, () => Promise.resolve("second"));
         fake.start(first);
         other.start(second);

         expect(await first.invoke("getToken")).toStrictEqual(ok("first"));
         expect(await second.invoke("getToken")).toStrictEqual(ok("second"));
      });

      it("ignores a worker that is stopping, and logs a lookup that fails", () => {
         const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
         main.attachServiceWorkers(fake.session);
         fake.serviceWorkers.getWorkerFromVersionID.mockImplementation(() => undefined);
         expect(() => fake.status(5, "starting")).not.toThrowError();
         fake.serviceWorkers.getWorkerFromVersionID.mockImplementation(() => {
            throw new Error("lookup failed");
         });
         expect(() => fake.status(6, "running")).not.toThrowError();
         expect(error).toHaveBeenCalledOnce();
      });
   });
});

describe("service worker channels, with rawErrors", () => {
   it("leaves the result and the errors of the handler to Electron", async () => {
      project = await runFixture("service-worker-channels");
      const source = project.generated["main.ts"];
      expect(source).toContain("settleInvoke(");
      // The same schema with the config turned on has no envelope around the handler.
      const raw = await runFixture("service-worker-raw-errors");
      try {
         const main = loadWorkerMain(raw);
         const fake = createSession();
         const one = createWorker();
         let calls = 0;
         main.ipc.getToken.handle(fake.session, () => {
            calls += 1;
            if (calls > 1) {
               throw Object.assign(new Error("no token"), { code: "E_TOKEN" });
            }
            return "plain";
         });
         fake.start(one);

         expect(await one.invoke("getToken")).toBe("plain");
         // The error is Electron's, which keeps the message only, and not the envelope of the library.
         await expect(one.invoke("getToken")).rejects.toThrow(
            "Error invoking remote method 'autoipc:getToken': Error: no token",
         );
         expect(raw.generated["main.ts"]).not.toContain("settleInvoke");
         expect(raw.generated["service-worker-preload.ts"]).toContain(
            "invoke: (...args: any[]) => ipcRenderer.invoke('autoipc:getToken', ...args),",
         );
      } finally {
         await raw.cleanup();
      }
   });
});
