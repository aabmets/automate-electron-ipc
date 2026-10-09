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

describe("public types of the vite entry", () => {
   it("declares the file that the vite entry of the package points at", () => {
      expect(manifest.exports["./vite"].types).toBe("./types/vite.d.ts");
   });

   it("resolves autoipc with the declared types, and assigns it to a Vite-shaped plugin", async () => {
      const diagnostics = await typecheck({
         "use.ts": `
            import { autoipc } from "automate-electron-ipc/vite";
            import type { VitePluginLike } from "automate-electron-ipc/vite";

            // The shape of Vite's own Plugin hooks that the plugin has to be assignable to.
            interface ViteLikePlugin {
               name: string;
               buildStart?: (this: unknown) => void | Promise<void>;
               configureServer?: (server: {
                  watcher: { add(paths: string | readonly string[]): unknown };
               }) => void | (() => void) | Promise<void | (() => void)>;
               handleHotUpdate?: (ctx: {
                  file: string;
                  modules: object[];
               }) => void | object[] | Promise<void | object[]>;
            }

            const plugin: VitePluginLike = autoipc({ cwd: ".", logger: false });
            const plugins: ViteLikePlugin[] = [autoipc(), plugin];
            export default plugins;
         `,
      });
      expect(diagnostics).toBe("");
   });

   it("rejects options that are not declared", async () => {
      const diagnostics = await typecheck({
         "use.ts": `
            import { autoipc } from "automate-electron-ipc/vite";

            autoipc({ logger: "yes" });
            autoipc({ other: 1 });
         `,
      });
      for (const line of [4, 5]) {
         expect(diagnostics).toContain(`use.ts(${line},`);
      }
   });
});
