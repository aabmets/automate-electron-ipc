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

import fsp from "node:fs/promises";
import path from "node:path";
import {
   callablePaths,
   createFakeElectron,
   createFakePreloadElectron,
   loadGenerated,
   windowIpcPaths,
} from "@testutils/e2e/runtime-utils.js";
import {
   createChild,
   createParentPort,
   flush,
   load,
   resetUtilityFakes,
   wire,
} from "@testutils/e2e/utility-process-utils.js";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { afterEach, describe, expect, it } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   await resetUtilityFakes();
   await project?.cleanup();
   project = undefined;
});

describe("utility channels, files", () => {
   it("type-checks main.ts, utility.ts and the code which uses them", async () => {
      project = await runFixture("utility-channels");
      expect(await project.typecheck()).toBe("");
   });

   it("leaves the files for the renderer to the renderer channels", async () => {
      project = await runFixture("utility-channels");
      const preload = createFakePreloadElectron();
      loadGenerated(project.generated["preload.ts"], { electron: preload.electron });
      expect(callablePaths(preload.exposed.ipc)).toStrictEqual(["getJob.invoke"]);
      expect(windowIpcPaths(project.generated["window.d.ts"])).toStrictEqual(["getJob.invoke"]);
      expect(project.generated["window.d.ts"]).not.toContain("Summary");
      expect(project.generated["preload.ts"]).not.toContain("indexFile");
   });

   it("writes the utility file next to the other files by default, and only for utility channels", async () => {
      project = await runFixture("utility-channels");
      expect(project.generated["utility.ts"]).toContain("export const ipc = {");
      await project.cleanup();

      project = await runFixture("ask-channels");
      expect(project.generated["utility.ts"]).toBeUndefined();
      const files = await fsp.readdir(path.join(project.dir, project.ipcDataDir));
      expect(files).not.toContain("utility.ts");
   });

   it("writes the utility file to the configured path, and leaves empty files for the renderer", async () => {
      project = await runFixture("utility-custom-path");
      expect(project.generated["utility.ts"]).toContain(
         'import type { Row } from "../../ipc/schema";',
      );
      expect(project.generated["main.ts"]).toContain('import type { Row } from "./schema";');
      expect(await project.typecheck()).toBe("");
      const files = await fsp.readdir(path.join(project.dir, project.ipcDataDir));
      expect(files).not.toContain("utility.ts");

      expect(project.generated["preload.ts"]).not.toContain("ipcRenderer");
      expect(windowIpcPaths(project.generated["window.d.ts"])).toStrictEqual([]);
      expect(project.generated["window.d.ts"]).not.toContain("Row");
   });
});

describe("utility channels, children which the bindings do not know", () => {
   const notAttached = {
      name: "IpcUtilityError",
      code: "IPC_UTILITY_NOT_ATTACHED",
      message: expect.stringContaining("forkUtility()"),
   };

   it("rejects invoke, as a promise does, and posts nothing", async () => {
      const { main } = await load();
      const { child } = createChild({ attached: false });

      const call = main.ipc.indexFile.invoke(child, "a");

      await expect(call).rejects.toMatchObject({ ...notAttached, channel: wire("indexFile") });
      await expect(call).rejects.toThrow("attachUtility(child) right after utilityProcess.fork()");
      expect(child.postMessage).not.toHaveBeenCalled();
      expect(child.listenerCount("message")).toBe(0);
      expect(child.listenerCount("exit")).toBe(0);
   });

   it("fails send, handle, on and once, and makes no peer for the child", async () => {
      const { main } = await load();
      const { child } = createChild({ attached: false });

      expect(() => main.ipc.pause.send(child)).toThrow(expect.objectContaining(notAttached));
      expect(() => main.ipc.getSetting.handle(child, async () => "x")).toThrow(
         expect.objectContaining({ ...notAttached, channel: wire("getSetting") }),
      );
      expect(() => main.ipc.progress.on(child, () => undefined)).toThrow(
         expect.objectContaining(notAttached),
      );
      expect(() => main.ipc.progress.once(child, () => undefined)).toThrow(
         expect.objectContaining(notAttached),
      );
      expect(child.listenerCount("message")).toBe(0);
      expect(child.listenerCount("exit")).toBe(0);
   });

   it("serves a child once attachUtility is called for it", async () => {
      const { main } = await load();
      const { child, posted } = createChild({ attached: false });
      expect(() => main.ipc.pause.send(child)).toThrow();

      main.attachUtility(child);
      main.ipc.pause.send(child);

      expect(posted("send", "pause")).toHaveLength(1);
   });

   it("forks with utilityProcess.fork and the same arguments, and attaches the child at once", async () => {
      project = await runFixture("utility-channels");
      const electron = createFakeElectron();
      const { child, posted } = createChild({ attached: false });
      electron.utilityProcess.fork.mockReturnValue(child);
      const main = loadGenerated(project.generated["main.ts"], { electron });
      const options = { serviceName: "indexer" };

      const forked = main.forkUtility("/app/child.js", ["--flag"], options);

      expect(forked).toBe(child);
      expect(electron.utilityProcess.fork).toHaveBeenCalledTimes(1);
      expect(electron.utilityProcess.fork).toHaveBeenCalledWith(
         "/app/child.js",
         ["--flag"],
         options,
      );
      expect(child.listenerCount("message")).toBe(1);
      expect(child.listenerCount("exit")).toBe(1);

      // It exits before any channel used it: the later calls are rejected, and nothing is posted.
      child.emit("exit", 1);
      await expect(main.ipc.indexFile.invoke(forked, "a")).rejects.toMatchObject({
         code: "IPC_UTILITY_EXITED",
      });
      expect(() => main.ipc.pause.send(forked)).toThrow(
         expect.objectContaining({ code: "IPC_UTILITY_EXITED" }),
      );
      expect(posted("call")).toHaveLength(0);
   });

   it("answers a child which calls the main process from its start, when it was forked by forkUtility", async () => {
      project = await runFixture("utility-channels");
      const electron = createFakeElectron();
      const { child, posted, emitFromChild } = createChild({ attached: false });
      electron.utilityProcess.fork.mockReturnValue(child);
      const main = loadGenerated(project.generated["main.ts"], { electron });

      main.forkUtility("/app/child.js");
      emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 7, args: ["k"] });
      await flush();

      expect(posted("reply")[0]).toMatchObject({ id: 7, envelope: { ok: false } });
   });
});

describe("utility channels, main process and utility process together", () => {
   it("connects the two ends of every channel over a pair of ports", async () => {
      const { main, utility } = await load();
      const { child, emitFromChild } = createChild();
      const { port, emitFromMain } = createParentPort();
      // Each side posts to the other: the child posts to the port, and the port to the child.
      child.postMessage.mockImplementation((message) => emitFromMain(message));
      port.postMessage.mockImplementation((message) => emitFromChild(message));

      utility.ipc.indexFile.handle(async (path: string) => path.length);
      main.ipc.getSetting.handle(child, async (key: string) => key.toUpperCase());
      const seen: number[] = [];
      main.ipc.progress.on(child, (done: number) => seen.push(done));
      const levels: string[] = [];
      utility.ipc.setLogLevel.on((level: string) => levels.push(level));

      const length = await main.ipc.indexFile.invoke(child, "/tmp/file");
      const setting = await utility.ipc.getSetting.invoke("theme");
      utility.ipc.progress.send(3, 4);
      main.ipc.setLogLevel.send(child, "info");

      expect(length).toBe(9);
      expect(setting).toBe("THEME");
      expect(seen).toStrictEqual([3]);
      expect(levels).toStrictEqual(["info"]);
   });
});
