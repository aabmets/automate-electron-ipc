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
import { tmpdir } from "node:os";
import path from "node:path";
import { watchSchema } from "@src/watch.js";
import { createRunTracker } from "@testutils/watch/fake-watch.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = path.resolve(import.meta.dirname, "../../fixtures/electron-core");

describe("ipcgen --watch with a real directory", () => {
   let dir = "";
   let close: (() => void) | undefined;

   beforeEach(async () => {
      dir = await fsp.mkdtemp(path.join(tmpdir(), "vitest-watch-e2e-"));
      await fsp.cp(fixture, dir, { recursive: true });
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
   });

   afterEach(async () => {
      close?.();
      close = undefined;
      vi.restoreAllMocks();
      await fsp.rm(dir, { recursive: true, force: true });
   });

   it("generates again after an edit, reports a syntax error, and recovers when it is fixed", async () => {
      const schemaPath = path.join(dir, "ipc/schema.ts");
      const original = await fsp.readFile(schemaPath, "utf8");
      const tracker = createRunTracker();
      const readMain = () => fsp.readFile(path.join(dir, "ipc/main.ts"), "utf8");
      /** Waits for runs, one after the other, until the check passes. */
      const untilRun = async (check: () => boolean | Promise<boolean>) => {
         // biome-ignore lint/performance/noAwaitInLoops: each run is awaited before the check
         while (!(await check())) {
            await tracker.until(tracker.errors.length + 1);
         }
      };
      close = watchSchema({ cwd: dir }, { debounceMs: 20, onRun: tracker.onRun });

      await tracker.until(1);
      expect(await readMain()).toContain("getValue");
      expect(await readMain()).not.toContain("freshChannel");

      await fsp.writeFile(
         schemaPath,
         original.replace(
            "   getValue:",
            "   freshChannel: invoke<() => Promise<string>>(),\n   getValue:",
         ),
      );
      await untilRun(async () => (await readMain()).includes("freshChannel"));

      await fsp.writeFile(schemaPath, "export default defineChannels({ oops: invoke<( >() });\n");
      await untilRun(() => tracker.errors.at(-1) instanceof Error);
      expect(String((tracker.errors.at(-1) as Error).message)).toContain("schema.ts");
      // The last good bindings stay in place while the schema is broken.
      expect(await readMain()).toContain("freshChannel");

      await fsp.writeFile(schemaPath, original);
      await untilRun(() => tracker.errors.at(-1) === null);
      expect(await readMain()).not.toContain("freshChannel");
   });
});
