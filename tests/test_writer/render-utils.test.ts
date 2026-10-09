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

import { renderSpecs, renderWith } from "@testutils/writer/render-utils.js";
import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import {
   VitestMainBindingsWriter,
   VitestPreloadBindingsWriter,
   VitestRendererTypesWriter,
} from "@testutils/writer/test-writers.js";
import { buildFileSpecs, getIt, getUser, sendIt } from "@testutils/writer/writer-utils.js";
import { describe, expect, it } from "vitest";

describe("the writers for the tests", () => {
   mockGetTargetFilePath(VitestMainBindingsWriter);
   mockGetTargetFilePath(VitestPreloadBindingsWriter);
   mockGetTargetFilePath(VitestRendererTypesWriter);

   it("write the file of the channels they are given, and read it back", async () => {
      const output = await renderWith(VitestMainBindingsWriter, [getIt, sendIt]);

      expect(output).toContain("getIt: {");
      expect(output).toContain("sendIt: {");
      expect(output).not.toContain("getUser");
   });

   it("take the config as given, and indent the code by 3 unless it says otherwise", async () => {
      const prefixed = await renderWith(VitestMainBindingsWriter, [getIt], {
         channelPrefix: "app:",
      });
      const wide = await renderWith(VitestMainBindingsWriter, [getIt], { codeIndent: 5 });

      expect(prefixed).toContain("'app:getIt'");
      expect(wide).toContain("\n     getIt: {");
      expect(await renderWith(VitestMainBindingsWriter, [getIt])).toContain("\n   getIt: {");
   });

   it("pass the scope of the surface on to the writer", async () => {
      const specs = buildFileSpecs({ ...sendIt, scopes: ["settings"] });

      const scoped = await renderSpecs(VitestPreloadBindingsWriter, specs, {}, "settings");

      expect(scoped).toContain("sendIt: {");
      const writer = new VitestPreloadBindingsWriter(specs, {}, "settings");
      expect((writer as unknown as { scope: string }).scope).toBe("settings");
   });

   it("describe the same channels in every file that shares the constants", async () => {
      const types = await renderWith(VitestRendererTypesWriter, [getUser]);

      expect(types).toContain("getUser: {");
      expect(types).toContain("invoke");
   });
});
