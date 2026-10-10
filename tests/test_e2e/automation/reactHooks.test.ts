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

const JSX_OPTIONS = { jsx: "react-jsx" };

describe("React hooks, fixture react-hooks", () => {
   it("writes hooks.react.ts next to the types module, with the type aliases", async () => {
      const project = await fixtures.run("react-hooks");
      const hooks = await project.read("hooks.react.ts");

      expect(hooks).toContain('import { useCallback, useEffect, useRef, useState } from "react";');
      expect(hooks).toContain('import type { IpcApi } from "./types";');
      expect(hooks).toContain("export function useIpcEvent<N extends EventName>");
      expect(hooks).toContain("export function useIpcInvoke<N extends InvokeName>");
      expect(hooks).toContain('(globalThis as unknown as Record<string, IpcApi>)["ipc"]');
   });

   it("types the hooks against the API: names, callbacks, arguments and results", async () => {
      const project = await fixtures.run("react-hooks");

      // The consumer holds a `@ts-expect-error` for each misuse, so an unused one is reported here.
      expect(await project.typecheckFiles(["ipc/consumer.tsx"], JSX_OPTIONS)).toBe("");
   }, 60_000);

   it("type-checks with the rest of the generated files of the project", async () => {
      const project = await fixtures.run("react-hooks");

      expect(await project.typecheck(JSX_OPTIONS)).toBe("");
   }, 60_000);

   // The check must be able to fail: a misuse is reported with the file that has it.
   it("reports a hook call that does not match the API", async () => {
      const project = await fixtures.run("react-hooks");
      await fsp.writeFile(
         path.join(project.dir, project.ipcDataDir, "wrong.tsx"),
         [
            'import { useIpcEvent } from "./hooks.react";',
            "export function Wrong() {",
            '   useIpcEvent("moved", (x: string) => x);',
            "}",
         ].join("\n"),
      );

      const diagnostics = await project.typecheckFiles(["ipc/wrong.tsx"], JSX_OPTIONS);

      expect(diagnostics).toContain("wrong.tsx");
   }, 60_000);

   it("names the aliases of the API without a channel as never", async () => {
      const project = await fixtures.run("react-hooks");
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
            'import type { EventName, InvokeName } from "./hooks.react";',
            "export const events: EventName[] = [];",
            "export const invokes: InvokeName[] = [];",
            "// @ts-expect-error there is no event channel in the schema",
            'export const event: EventName = "ping";',
            "// @ts-expect-error there is no invoke channel in the schema",
            'export const invoke: InvokeName = "ping";',
         ].join("\n"),
      );

      expect(await project.typecheckFiles(["ipc/never.ts"], JSX_OPTIONS)).toBe("");
   }, 60_000);
});
