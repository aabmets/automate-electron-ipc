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

import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import { VitestVueHooksWriter } from "@testutils/writer/test-writers.js";
import { buildFileSpecs, getIt } from "@testutils/writer/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("VueHooksWriter", () => {
   mockGetTargetFilePath(VitestVueHooksWriter);

   const render = (
      config: Partial<t.IPCResolvedConfig> = {},
      pfsArray: t.ParsedFileSpecs[] = buildFileSpecs(getIt),
   ) => new VitestVueHooksWriter(pfsArray, config).render(false);

   it("imports the functions and the types of Vue, and the type of the API from the types module", () => {
      const output = render();

      expect(output).toContain(
         'import { onScopeDispose, ref, shallowRef } from "vue";\n' +
            'import type { Ref, ShallowRef } from "vue";\n' +
            'import type { IpcApi } from "./types";\n',
      );
   });

   it("exports the two composables and the aliases of the names, the callbacks and the results", () => {
      const output = render();

      for (const name of [
         "export function useIpcEvent<N extends EventName>(name: N, callback: EventCallback<N>): void {",
         "export function useIpcInvoke<N extends InvokeName>(",
         "export type EventName = {",
         "export type EventCallback<N extends EventName> =",
         "export type InvokeName = {",
         "export type InvokeArgs<N extends InvokeName> =",
         "export type InvokeReturn<N extends InvokeName> =",
      ]) {
         expect(output).toContain(name);
      }
   });

   it("picks the event channels by `on` and `once`, which a port channel does not have", () => {
      expect(render()).toContain(
         "IpcApi[N] extends {\n" +
            "      on: (...args: any[]) => any;\n" +
            "      once: (...args: any[]) => any;\n" +
            "   }",
      );
   });

   it("subscribes at once, and unsubscribes when the scope is disposed", () => {
      const output = render();

      expect(output).toContain("const unsubscribe = events.on(");
      expect(output).toContain("onScopeDispose(unsubscribe);");
   });

   it("returns the state of a call as refs: data and error shallow, pending deep", () => {
      const output = render();

      expect(output).toContain("data: ShallowRef<InvokeReturn<N> | undefined>;");
      expect(output).toContain("error: ShallowRef<unknown>;");
      expect(output).toContain("pending: Ref<boolean>;");
   });

   it("writes no code of React", () => {
      expect(render()).not.toMatch(/react|useEffect|useState/i);
   });

   it("reads the API from the global that exposeAs names", () => {
      expect(render()).toContain(
         'return (globalThis as unknown as Record<string, IpcApi>)["ipc"];',
      );
      expect(render({ exposeAs: "bridge" })).toContain(
         'return (globalThis as unknown as Record<string, IpcApi>)["bridge"];',
      );
   });

   it("writes the file, with aliases of no channel, for a schema without channels", () => {
      const output = render({}, []);

      expect(output).toContain("export function useIpcEvent");
      expect(output).toContain("}[keyof IpcApi];");
   });

   it.each([2, 4])("indents the code by codeIndent %i", (codeIndent) => {
      const output = render({ codeIndent });
      const unit = " ".repeat(codeIndent);

      expect(output).toContain(`\n${unit}const pending = ref(false);\n`);
      expect(output).toContain(`\n${unit}${unit}disposed = true;\n`);
      const misaligned = output
         .split("\n")
         .filter((line) => /^ +\S/.test(line))
         .filter((line) => (line.length - line.trimStart().length) % codeIndent !== 0);
      // Only the continuation lines of doc comments start one space in.
      expect(misaligned.filter((line) => !line.startsWith(" *"))).toStrictEqual([]);
   });

   it("imports the types module with the extension that NodeNext needs", () => {
      expect(render({ projectUsesNodeNext: true })).toContain(
         'import type { IpcApi } from "./types.js";',
      );
   });

   it("has no blank line twice in a row", () => {
      expect(render()).not.toContain("\n\n\n");
   });
});
