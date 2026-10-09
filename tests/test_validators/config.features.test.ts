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

import { validateOptionalConfig } from "@src/validation/config-validation.js";
import { describe, expect, it } from "vitest";

describe("validateOptionalConfig, serializer", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };
   const check = (serializer: unknown) =>
      validateOptionalConfig({ ...config, serializer: serializer as string });

   it.each([
      "superjson",
      "@scope/wire",
      "pkg/sub/path",
      "msgpack-lite",
      "./wire.ts",
      "../shared/wire",
      "./src/lib/wire.codec.ts",
   ])("accepts '%s'", (value) => {
      expect(() => check(value)).not.toThrowError();
   });

   it("accepts a config without a serializer", () => {
      expect(() => validateOptionalConfig(config)).not.toThrowError();
   });

   it.each([
      "",
      "/abs/wire.ts",
      ".wire",
      "..",
      "./",
      'wire"; import "evil',
      "has space",
      "back\\slash",
      "node:fs",
      "line\nbreak",
   ])("rejects %j", (value) => {
      expect(() => check(value)).toThrowError(/serializer/);
   });

   it.each([5, true, null, []])("rejects %j, since it is not a string", (value) => {
      expect(() => check(value)).toThrowError(/serializer/);
   });
});

describe("validateOptionalConfig, autoExpose", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };
   const check = (autoExpose: unknown) =>
      validateOptionalConfig({ ...config, autoExpose: autoExpose as boolean });

   it.each([true, false])("accepts %s", (value) => {
      expect(() => check(value)).not.toThrowError();
   });

   it.each(["false", 0, 1, null, []])("rejects %j, since it is not a boolean", (value) => {
      expect(() => check(value)).toThrowError(/autoExpose/);
   });
});

describe("validateOptionalConfig, utilityBindingsPath", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };

   it.each(["utility.ts", "src/worker/ipc.ts", "worker/ipc.mts", "worker/ipc.cts", undefined])(
      "accepts %s",
      (utilityBindingsPath) => {
         expect(() =>
            validateOptionalConfig({ ...config, utilityBindingsPath }),
         ).not.toThrowError();
      },
   );

   it("rejects an absolute path", () => {
      expect(() =>
         validateOptionalConfig({ ...config, utilityBindingsPath: "/srv/ipc.ts" }),
      ).toThrowError("utilityBindingsPath must be relative to the project root");
   });

   it.each([
      "worker/ipc",
      "worker/ipc.js",
      "worker/ipc.d.ts",
      "worker/ipc.d.mts",
      "worker/ipc.d.cts",
      "",
   ])("rejects %j, since it is not the path of a .ts file", (utilityBindingsPath) => {
      expect(() => validateOptionalConfig({ ...config, utilityBindingsPath })).toThrowError(
         "utilityBindingsPath must be the path of a .ts file",
      );
   });

   it("rejects a value which is not a string", () => {
      const value = 5 as unknown as string;
      expect(() => validateOptionalConfig({ ...config, utilityBindingsPath: value })).toThrowError(
         /utilityBindingsPath/,
      );
   });
});

describe("validateOptionalConfig, serviceWorkerPreloadPath", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };

   it.each([
      "sw-preload.ts",
      "src/worker/preload.ts",
      "worker/preload.mts",
      "worker/preload.cts",
      undefined,
   ])("accepts %s", (serviceWorkerPreloadPath) => {
      expect(() =>
         validateOptionalConfig({ ...config, serviceWorkerPreloadPath }),
      ).not.toThrowError();
   });

   it("rejects an absolute path", () => {
      expect(() =>
         validateOptionalConfig({ ...config, serviceWorkerPreloadPath: "/srv/sw.ts" }),
      ).toThrowError("serviceWorkerPreloadPath must be relative to the project root");
   });

   it.each([
      "worker/preload",
      "worker/preload.js",
      "worker/preload.d.ts",
      "worker/preload.d.mts",
      "worker/preload.d.cts",
      "",
   ])("rejects %j, since it is not the path of a .ts file", (serviceWorkerPreloadPath) => {
      expect(() => validateOptionalConfig({ ...config, serviceWorkerPreloadPath })).toThrowError(
         "serviceWorkerPreloadPath must be the path of a .ts file",
      );
   });

   it("rejects a value which is not a string", () => {
      const value = 5 as unknown as string;
      expect(() =>
         validateOptionalConfig({ ...config, serviceWorkerPreloadPath: value }),
      ).toThrowError(/serviceWorkerPreloadPath/);
   });
});
