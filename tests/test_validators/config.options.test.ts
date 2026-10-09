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

import { validateOptionalConfig } from "@src/config-validation.js";
import * as t from "@types";
import { describe, expect, it } from "vitest";

describe("validateOptionalConfig", () => {
   it("should throw an error if ipcDataDir path is absolute", () => {
      const config: t.IPCOptionalConfig = {
         projectUsesNodeNext: false,
         ipcDataDir: "/absolute/path/auto-ipc",
         codeIndent: 3,
      };
      expect(() => validateOptionalConfig(config)).toThrowError(
         "ipcDataDir must be relative to the project root",
      );
   });

   it("should throw an error if codeIndent is not an integer", () => {
      // Regression for T58: 2.5 was accepted and silently rounded down by `repeat`.
      const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc" };
      expect(() => validateOptionalConfig({ ...config, codeIndent: 2.5 })).toThrowError(/integer/);
      expect(() => validateOptionalConfig({ ...config, codeIndent: 3.999 })).toThrowError(
         /integer/,
      );
      expect(() => validateOptionalConfig({ ...config, codeIndent: 1 })).toThrowError(
         /cannot be less than 2 or greater than 4/,
      );
      for (const codeIndent of [2, 3, 4]) {
         expect(() => validateOptionalConfig({ ...config, codeIndent })).not.toThrowError();
      }
   });

   it("should throw errors if codeIndent value is out of range", () => {
      const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc" };
      for (const codeIndent of [1, 5]) {
         expect(() => validateOptionalConfig({ ...config, codeIndent })).toThrowError(
            "value cannot be less than 2 or greater than 4",
         );
      }
   });
});

describe("validateOptionalConfig, rawErrors", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };

   it("accepts a boolean, and no value at all", () => {
      for (const rawErrors of [true, false, undefined]) {
         expect(() => validateOptionalConfig({ ...config, rawErrors })).not.toThrowError();
      }
   });

   it.each(["true", 1, null, {}])("rejects %j, since it is not a boolean", (rawErrors) => {
      const value = rawErrors as unknown as boolean;
      expect(() => validateOptionalConfig({ ...config, rawErrors: value })).toThrowError(
         /rawErrors/,
      );
   });
});

describe("validateOptionalConfig, timeoutMs", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };

   it.each([0, 1, 30_000, Number.MAX_SAFE_INTEGER, undefined])("accepts %s", (timeoutMs) => {
      expect(() => validateOptionalConfig({ ...config, timeoutMs })).not.toThrowError();
   });

   it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "10", null])(
      "rejects %j, since it is not a non-negative integer",
      (timeoutMs) => {
         const value = timeoutMs as unknown as number;
         expect(() => validateOptionalConfig({ ...config, timeoutMs: value })).toThrowError(
            /timeoutMs/,
         );
      },
   );
});

describe("validateOptionalConfig, channelPrefix", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };
   const check = (channelPrefix: unknown) =>
      validateOptionalConfig({ ...config, channelPrefix: channelPrefix as string });

   it.each(["", "autoipc:", "my-app/v1:", "app_2.", "@scope/app#", "A".repeat(64)])(
      "accepts '%s'",
      (prefix) => {
         expect(() => check(prefix)).not.toThrowError();
      },
   );

   it("accepts a config without a prefix", () => {
      expect(() => validateOptionalConfig(config)).not.toThrowError();
   });

   it.each([
      "it's",
      'say "hi"',
      "back\\slash",
      "two words",
      "line\nbreak",
      "tab\t",
      "${x}",
      "`",
      "é",
   ])("rejects %j, since it would break the generated string literal or the name", (prefix) => {
      expect(() => check(prefix)).toThrowError(/channelPrefix can contain only/);
   });

   it("rejects a prefix of more than 64 characters", () => {
      expect(() => check("a".repeat(65))).toThrowError(/longer than 64/);
   });

   it.each([5, null, true, ["a"]])("rejects %j, since it is not a string", (prefix) => {
      expect(() => check(prefix)).toThrowError(/channelPrefix/);
   });
});

describe("validateOptionalConfig, exposeAs", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };
   const check = (exposeAs: unknown) =>
      validateOptionalConfig({ ...config, exposeAs: exposeAs as string });

   it.each(["ipc", "api", "myApp", "_bridge", "$ipc", "ipc2", "IpcApi", "electronApi"])(
      "accepts '%s'",
      (name) => {
         expect(() => check(name)).not.toThrowError();
      },
   );

   it.each(["", "my-app", "2ipc", "two words", "a.b", "it's", "ipc;", "é", "ipc\n"])(
      "rejects %j, since it is not an identifier",
      (name) => {
         expect(() => check(name)).toThrowError(/exposeAs must be an identifier/);
      },
   );

   it.each(["name", "status", "close", "open", "top", "length", "document", "fetch", "location"])(
      "rejects the property '%s' of window",
      (name) => {
         expect(() => check(name)).toThrowError(/reserved word or a global of the page/);
      },
   );

   it.each(["class", "default", "new", "null", "true", "typeof", "eval", "arguments"])(
      "rejects the reserved word '%s'",
      (name) => {
         expect(() => check(name)).toThrowError(/reserved word or a global of the page/);
      },
   );

   it.each(["Promise", "Error", "Symbol", "Object", "globalThis", "process", "require"])(
      "rejects the global '%s'",
      (name) => {
         expect(() => check(name)).toThrowError(/reserved word or a global of the page/);
      },
   );

   it.each([5, null, true, ["a"]])("rejects %j, since it is not a string", (name) => {
      expect(() => check(name)).toThrowError(/exposeAs/);
   });
});

describe("validateOptionalConfig, isolatedWorldId", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };
   const check = (isolatedWorldId: unknown) =>
      validateOptionalConfig({ ...config, isolatedWorldId: isolatedWorldId as number });

   it.each([1000, 1001, 5000, 2 ** 31 - 1])("accepts %d", (id) => {
      expect(() => check(id)).not.toThrowError();
   });

   it("accepts a config without a world", () => {
      expect(() => validateOptionalConfig(config)).not.toThrowError();
   });

   it.each([0, 1, 999, -1000, 1000.5, 2 ** 31, Number.POSITIVE_INFINITY])("rejects %d", (id) => {
      expect(() => check(id)).toThrowError(/isolatedWorldId must be an integer of 1000 or more/);
   });

   it.each(["1000", null, true, [1000], Number.NaN])(
      "rejects %j, since it is not a number",
      (id) => {
         expect(() => check(id)).toThrowError(/isolatedWorldId/);
      },
   );
});

describe("validateOptionalConfig, getPathForFile", () => {
   const config = { projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 };
   const check = (getPathForFile: unknown) =>
      validateOptionalConfig({ ...config, getPathForFile: getPathForFile as boolean });

   it.each([true, false])("accepts %s", (value) => {
      expect(() => check(value)).not.toThrowError();
   });

   it.each(["true", 1, null, []])("rejects %j, since it is not a boolean", (value) => {
      expect(() => check(value)).toThrowError(/getPathForFile/);
   });
});
