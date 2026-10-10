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

import { pruneUnusedHelpers } from "@src/writer/prune-helpers.js";
import { describe, expect, it } from "vitest";

describe("pruneUnusedHelpers", () => {
   it("removes a function that nothing calls, with the comment above it and the blank line below", () => {
      const text = [
         "const keep = 1;",
         "",
         "/** Sends. */",
         "function sendUtilityPeer(peer: string): void {",
         "   console.log(peer);",
         "}",
         "",
         "export const ipc = { keep };",
      ].join("\n");

      expect(pruneUnusedHelpers(text)).toBe(
         ["const keep = 1;", "", "export const ipc = { keep };"].join("\n"),
      );
   });

   it("keeps a helper that the file calls", () => {
      const text =
         "function sendUtilityPeer(): void {\n}\n\nexport const f = () => sendUtilityPeer();";

      expect(pruneUnusedHelpers(text)).toBe(text);
   });

   it("removes a helper that only another unused helper calls, whichever comes first", () => {
      const text = [
         "function readArguments(): void {",
         "   decodeValue();",
         "}",
         "",
         "function decodeValue(): void {",
         "}",
         "",
         "export const ipc = {};",
      ].join("\n");

      expect(pruneUnusedHelpers(text)).toBe("export const ipc = {};");
   });

   it("removes the declarations of types and variables of the list", () => {
      const text = [
         "type IpcEnvelope = { ok: true };",
         "let lastUtilityCallId = 0;",
         "interface Other {",
         "}",
         "export const ipc = {};",
      ].join("\n");

      expect(pruneUnusedHelpers(text)).toBe(
         ["interface Other {", "}", "export const ipc = {};"].join("\n"),
      );
   });

   it("leaves a function that is not in the list alone, used or not", () => {
      const text = "function notAHelper(): void {\n}\nexport const ipc = {};";

      expect(pruneUnusedHelpers(text)).toBe(text);
   });

   it("does not count the name of the helper in its own body as a use", () => {
      const text =
         "function callUtilityPeer(): void {\n   callUtilityPeer();\n}\nexport const ipc = {};";

      expect(pruneUnusedHelpers(text)).toBe("export const ipc = {};");
   });

   it("drops the name of the serializer from the import when its helper is gone", () => {
      const text = [
         'import { serialize as ipcSerialize, deserialize as ipcDeserialize } from "superjson";',
         "function encodeValue(): unknown {",
         "   return ipcSerialize(1);",
         "}",
         "function decodeValue(): unknown {",
         "   return ipcDeserialize(1);",
         "}",
         "export const ipc = { read: () => decodeValue() };",
      ].join("\n");

      expect(pruneUnusedHelpers(text)).toBe(
         [
            'import { deserialize as ipcDeserialize } from "superjson";',
            "function decodeValue(): unknown {",
            "   return ipcDeserialize(1);",
            "}",
            "export const ipc = { read: () => decodeValue() };",
         ].join("\n"),
      );
   });

   it("drops the whole import of the serializer when no helper uses it", () => {
      const text = [
         'import { serialize as ipcSerialize, deserialize as ipcDeserialize } from "superjson";',
         "function encodeValue(): unknown {",
         "   return ipcSerialize(1);",
         "}",
         "export const ipc = {};",
      ].join("\n");

      expect(pruneUnusedHelpers(text)).toBe("export const ipc = {};");
   });
});
