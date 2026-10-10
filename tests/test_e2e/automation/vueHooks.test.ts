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
import { fixtures } from "@testutils/fixture-tracker.js";
import { describe, expect, it } from "vitest";

describe("Vue composables, fixture vue-hooks", () => {
   it("writes hooks.vue.ts next to the types module, with the type aliases", async () => {
      const project = await fixtures.run("vue-hooks");
      const hooks = await project.read("hooks.vue.ts");

      expect(hooks).toContain(
         'import { onScopeDispose, ref, shallowRef } from "vue";\nimport type { Ref, ShallowRef } from "vue";',
      );
      expect(hooks).toContain('import type { IpcApi } from "./types";');
      expect(hooks).toContain("export function useIpcEvent<N extends EventName>");
      expect(hooks).toContain("export function useIpcInvoke<N extends InvokeName>");
      expect(hooks).toContain('(globalThis as unknown as Record<string, IpcApi>)["ipc"]');
   });

   it("types the hooks against the API: names, callbacks, arguments and results", async () => {
      const project = await fixtures.run("vue-hooks");

      // The consumer holds a `@ts-expect-error` for each misuse, so an unused one is reported here.
      expect(await project.typecheckFiles(["ipc/consumer.ts"])).toBe("");
   }, 60_000);

   it("type-checks with the rest of the generated files of the project", async () => {
      const project = await fixtures.run("vue-hooks");

      expect(await project.typecheck()).toBe("");
   }, 60_000);

   // The check must be able to fail: a misuse is reported with the file that has it.
   it("reports a hook call that does not match the API", async () => {
      const project = await fixtures.run("vue-hooks");
      await fsp.writeFile(
         path.join(project.dir, project.ipcDataDir, "wrong.ts"),
         [
            'import { useIpcEvent } from "./hooks.vue";',
            "export function Wrong() {",
            '   useIpcEvent("moved", (x: string) => x);',
            "}",
         ].join("\n"),
      );

      const diagnostics = await project.typecheckFiles(["ipc/wrong.ts"]);

      expect(diagnostics).toContain("wrong.ts");
   }, 60_000);

   it("names the aliases of the API without a channel as never", async () => {
      const project = await fixtures.run("vue-hooks");
      await fsp.writeFile(
         path.join(project.dir, project.ipcDataDir, "schema/main.ts"),
         'import { defineChannels, send } from "automate-electron-ipc";\n' +
            "export default defineChannels({ ping: send<() => void>() });\n",
      );
      const { ipcAutomation } = await import("@src/automation.js");
      await ipcAutomation(project.dir);
      await fsp.writeFile(
         path.join(project.dir, project.ipcDataDir, "never.ts"),
         [
            'import type { EventName, InvokeName } from "./hooks.vue";',
            "export const events: EventName[] = [];",
            "export const invokes: InvokeName[] = [];",
            "// @ts-expect-error there is no event channel in the schema",
            'export const event: EventName = "ping";',
            "// @ts-expect-error there is no invoke channel in the schema",
            'export const invoke: InvokeName = "ping";',
         ].join("\n"),
      );

      expect(await project.typecheckFiles(["ipc/never.ts"])).toBe("");
   }, 60_000);
});
