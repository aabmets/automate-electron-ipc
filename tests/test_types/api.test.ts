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

import fs from "node:fs";
import path from "node:path";
import { typecheck } from "@testutils/tsc-utils.js";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
   fs.readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf8"),
);

describe("public types of the api entry", () => {
   it("declares the file that the api entry of the package points at", () => {
      expect(manifest.exports["./api"].types).toBe("./types/api.d.ts");
   });

   it("resolves generate and check with the declared types", async () => {
      const diagnostics = await typecheck({
         "use.ts": `
            import { check, generate } from "automate-electron-ipc/api";
            import type { CheckResult, GenerateOptions, GenerateResult } from "automate-electron-ipc/api";

            const options: GenerateOptions = {
               cwd: ".",
               configFile: "autoipc.config.json",
               overrides: { codeIndent: 2, mainBindingsPath: "out/main.ts" },
               logger: true,
            };
            export async function run(): Promise<void> {
               const result: GenerateResult = await generate(options);
               const files: string[] = result.files;
               const channels: number = result.channels;
               const checked: CheckResult = await check();
               const stale: string[] = checked.stale;
               await generate();
               await check({ cwd: "." });
               void [files, channels, stale];
            }
         `,
      });
      expect(diagnostics).toBe("");
   });

   it("rejects options and results that are not declared", async () => {
      const diagnostics = await typecheck({
         "use.ts": `
            import { check, generate } from "automate-electron-ipc/api";

            export async function run(): Promise<void> {
               await generate({ logger: "yes" });
               await generate({ overrides: { notAnOption: true } });
               await generate({ other: 1 });
               const result = await generate();
               const nope: string = result.channels;
               const stale: number = (await check()).stale;
               void [nope, stale];
            }
         `,
      });
      for (const line of [5, 6, 7, 9, 10]) {
         expect(diagnostics).toContain(`use.ts(${line},`);
      }
      expect(diagnostics).not.toContain("use.ts(8,");
   });
});
