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

// Sender validation of the contents, the stream channels and the types of the option.

import fsp from "node:fs/promises";
import path from "node:path";
import { createContents, eventFrom, loadMain } from "@testutils/e2e/contents-handlers-utils.js";
import { ok } from "@testutils/e2e/wire-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { describe, expect, it, vi } from "vitest";

describe("the webContents option of listeners and handlers", () => {
   describe("sender validation", () => {
      it("checks the origin of the frame for a handler of the contents", async () => {
         const { ipc, generated, invoke } = await loadMain("sender-validation");
         const contents = createContents();
         const onRejected = vi.fn();
         generated.configureIpc({ onRejected });
         const callback = vi.fn(async () => "secret");
         ipc.getSecret.handle(callback, { webContents: contents });
         const handler = contents.ipc.handlers.get("autoipc:getSecret");

         const allowed = await handler?.(eventFrom(contents, "app://."), 1);
         const rejected = await handler?.(eventFrom(contents, "https://evil.example"), 1);

         expect(allowed).toStrictEqual(ok("secret"));
         expect(rejected).toMatchObject({ ok: false, error: { code: "IPC_FORBIDDEN" } });
         expect(callback).toHaveBeenCalledTimes(1);
         expect(onRejected).toHaveBeenCalledTimes(1);
         // The global dispatch finds the same handler for this page.
         await expect(invoke(contents, "getSecret", 1)).resolves.toStrictEqual(ok("secret"));
      });

      it("drops a send from a frame which is not allowed, for a listener of the contents", async () => {
         const { ipc, send } = await loadMain("sender-validation");
         const contents = createContents();
         const callback = vi.fn();
         ipc.logLine.on(callback, { webContents: contents });

         contents.ipc.emitter.emit(
            "autoipc:logLine",
            eventFrom(contents, "https://evil.example"),
            "x",
         );
         send(contents, "logLine", "y");

         expect(callback).toHaveBeenCalledTimes(1);
         expect(callback).toHaveBeenCalledWith(expect.anything(), "y");
      });
   });

   it("takes the option on the handler of a stream channel too", async () => {
      const { ipc, globalIpc } = await loadMain("stream-channels");
      const contents = createContents();

      const dispose = ipc.exportRows.handle(vi.fn(), { webContents: contents });

      expect(contents.ipc.handle).toHaveBeenCalledWith("autoipc:exportRows", expect.any(Function));
      expect(globalIpc.handle).not.toHaveBeenCalled();
      dispose();
      expect(contents.ipc.removeHandler).toHaveBeenCalledWith("autoipc:exportRows");
      expect(contents.ipc.handlers.size).toBe(0);
   });

   it("generates none of it for a schema which has no channel from a renderer to the main process", async () => {
      const project = await fixtures.run("port-only");
      const main = project.generated["main.ts"];

      expect(main).not.toContain("IpcListenOptions");
      expect(main).not.toContain("resolveIpcTarget");
   });
});

describe("fixture contents-handlers, the types of the webContents option", () => {
   it("accepts the option on handle, handleOnce, on, once and the handle of a stream", async () => {
      const project = await fixtures.run("contents-handlers");

      expect(project.generated["main.ts"]).toContain("export interface IpcListenOptions {");
      expect(await project.typecheck()).toBe("");
   });

   it("rejects a value which is not WebContents, and an option which does not exist", async () => {
      const project = await fixtures.run("contents-handlers");
      const usage = path.join(project.dir, project.ipcDataDir, "schema-usage.ts");
      const text = await fsp.readFile(usage, "utf8");
      const valid = "disposers.push(ipc.log.on(() => undefined, {}));";
      expect(text).toContain(valid);

      await fsp.writeFile(
         usage,
         text.replace(
            valid,
            'disposers.push(ipc.log.on(() => undefined, { webContents: "main" }));',
         ),
      );
      expect(await project.typecheck()).toContain("TS2322");

      await fsp.writeFile(
         usage,
         text.replace(valid, "disposers.push(ipc.log.on(() => undefined, { window: contents }));"),
      );
      expect(await project.typecheck()).toContain("TS2353");
   }, 60_000);
});
