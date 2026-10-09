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
import { baseConfig } from "@testutils/validator-utils.js";
import { describe, expect, it } from "vitest";

describe("validateOptionalConfig, serializer", () => {
   const check = (serializer: unknown) =>
      validateOptionalConfig({ ...baseConfig, serializer: serializer as string });

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
      expect(() => validateOptionalConfig(baseConfig)).not.toThrowError();
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
   const check = (autoExpose: unknown) =>
      validateOptionalConfig({ ...baseConfig, autoExpose: autoExpose as boolean });

   it.each([true, false])("accepts %s", (value) => {
      expect(() => check(value)).not.toThrowError();
   });

   it.each(["false", 0, 1, null, []])("rejects %j, since it is not a boolean", (value) => {
      expect(() => check(value)).toThrowError(/autoExpose/);
   });
});

describe("validateOptionalConfig, utilityBindingsPath", () => {
   it.each(["utility.ts", "src/worker/ipc.ts", "worker/ipc.mts", "worker/ipc.cts", undefined])(
      "accepts %s",
      (utilityBindingsPath) => {
         expect(() =>
            validateOptionalConfig({ ...baseConfig, utilityBindingsPath }),
         ).not.toThrowError();
      },
   );

   it("rejects an absolute path", () => {
      expect(() =>
         validateOptionalConfig({ ...baseConfig, utilityBindingsPath: "/srv/ipc.ts" }),
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
      expect(() => validateOptionalConfig({ ...baseConfig, utilityBindingsPath })).toThrowError(
         "utilityBindingsPath must be the path of a .ts file",
      );
   });

   it("rejects a value which is not a string", () => {
      const value = 5 as unknown as string;
      expect(() =>
         validateOptionalConfig({ ...baseConfig, utilityBindingsPath: value }),
      ).toThrowError(/utilityBindingsPath/);
   });
});

describe("validateOptionalConfig, serviceWorkerPreloadPath", () => {
   it.each([
      "sw-preload.ts",
      "src/worker/preload.ts",
      "worker/preload.mts",
      "worker/preload.cts",
      undefined,
   ])("accepts %s", (serviceWorkerPreloadPath) => {
      expect(() =>
         validateOptionalConfig({ ...baseConfig, serviceWorkerPreloadPath }),
      ).not.toThrowError();
   });

   it("rejects an absolute path", () => {
      expect(() =>
         validateOptionalConfig({ ...baseConfig, serviceWorkerPreloadPath: "/srv/sw.ts" }),
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
      expect(() =>
         validateOptionalConfig({ ...baseConfig, serviceWorkerPreloadPath }),
      ).toThrowError("serviceWorkerPreloadPath must be the path of a .ts file");
   });

   it("rejects a value which is not a string", () => {
      const value = 5 as unknown as string;
      expect(() =>
         validateOptionalConfig({ ...baseConfig, serviceWorkerPreloadPath: value }),
      ).toThrowError(/serviceWorkerPreloadPath/);
   });
});

describe("validateOptionalConfig, paths of the page files", () => {
   it.each([
      ["mainBindingsPath", "main.ts"],
      ["mainBindingsPath", "src/main/ipc.ts"],
      ["preloadBindingsPath", "src/preload/ipc.ts"],
      ["rendererTypesPath", "window.d.ts"],
      ["rendererTypesPath", "types/ipc.d.ts"],
   ])("accepts %s: %s", (option, value) => {
      expect(() => validateOptionalConfig({ ...baseConfig, [option]: value })).not.toThrowError();
   });

   it.each(["mainBindingsPath", "preloadBindingsPath", "rendererTypesPath"])(
      "rejects an absolute path for %s",
      (option) => {
         expect(() =>
            validateOptionalConfig({ ...baseConfig, [option]: "/srv/ipc.d.ts" }),
         ).toThrowError(`${option} must be relative to the project root`);
      },
   );

   it.each([
      ["mainBindingsPath", "main"],
      ["mainBindingsPath", "main.js"],
      ["mainBindingsPath", "main.mts"],
      ["mainBindingsPath", "main.d.ts"],
      ["preloadBindingsPath", "preload.cts"],
      ["preloadBindingsPath", "preload.d.ts"],
      ["preloadBindingsPath", ""],
   ])("rejects %s: %j, since it is not the path of a .ts file", (option, value) => {
      expect(() => validateOptionalConfig({ ...baseConfig, [option]: value })).toThrowError(
         `${option} must be the path of a .ts file`,
      );
   });

   it.each(["window.ts", "window", "window.d.mts", "window.js", "", "types.d.ts.map"])(
      "rejects rendererTypesPath: %j, since it is not the path of a .d.ts file",
      (value) => {
         expect(() =>
            validateOptionalConfig({ ...baseConfig, rendererTypesPath: value }),
         ).toThrowError("rendererTypesPath must be the path of a .d.ts file");
      },
   );

   it.each(["mainBindingsPath", "preloadBindingsPath", "rendererTypesPath"])(
      "rejects a value of %s which is not a string",
      (option) => {
         expect(() => validateOptionalConfig({ ...baseConfig, [option]: 5 })).toThrowError(
            new RegExp(option),
         );
      },
   );
});
