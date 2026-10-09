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

import { createFormatter, type FormatterResult, type SpawnFunction } from "@src/formatter.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const projectRoot = "/work/project";
const file = "/work/project/src/ipc/main.ts";

const ok = (stdout: string): FormatterResult => ({ status: 0, stdout, stderr: "" });

describe("createFormatter", () => {
   afterEach(() => {
      vi.restoreAllMocks();
   });

   it("makes no formatter for format false", () => {
      const spawn = vi.fn<SpawnFunction>();

      expect(createFormatter({ format: false, projectRoot }, spawn)).toBeNull();
      expect(spawn).not.toHaveBeenCalled();
   });

   it("runs biome from the bin directory of the project, with the text on stdin", () => {
      const spawn = vi.fn<SpawnFunction>().mockReturnValue(ok("formatted\n"));
      const format = createFormatter({ format: "biome", projectRoot }, spawn);

      expect(format?.(file, "raw")).toBe("formatted\n");

      expect(spawn).toHaveBeenCalledTimes(1);
      const [command, args, options] = spawn.mock.calls[0];
      expect(command).toMatch(/^\/work\/project[/\\]node_modules[/\\]\.bin[/\\]biome(\.cmd)?$/);
      expect(args).toStrictEqual(["format", "--stdin-file-path=src/ipc/main.ts"]);
      expect(options).toMatchObject({ cwd: projectRoot, input: "raw" });
   });

   it("runs prettier with its own flag for the file path", () => {
      const spawn = vi.fn<SpawnFunction>().mockReturnValue(ok("pretty\n"));
      const format = createFormatter({ format: "prettier", projectRoot }, spawn);

      expect(format?.(file, "raw")).toBe("pretty\n");

      const [command, args, options] = spawn.mock.calls[0];
      expect(command).toMatch(/[/\\]node_modules[/\\]\.bin[/\\]prettier(\.cmd)?$/);
      expect(args).toStrictEqual(["--stdin-filepath", "src/ipc/main.ts"]);
      expect(options).toMatchObject({ cwd: projectRoot, input: "raw" });
   });

   it("warns once and returns the text as it is when the binary is missing", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const missing = Object.assign(new Error("spawn biome ENOENT"), { code: "ENOENT" });
      const spawn = vi
         .fn<SpawnFunction>()
         .mockReturnValue({ status: null, stdout: "", stderr: "", error: missing });
      const format = createFormatter({ format: "biome", projectRoot }, spawn);

      expect(format?.(file, "one")).toBe("one");
      expect(format?.("/work/project/src/ipc/preload.ts", "two")).toBe("two");
      expect(format?.("/work/project/src/ipc/window.d.ts", "three")).toBe("three");

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("node_modules/.bin/biome");
      expect(warn.mock.calls[0][0]).toContain("unformatted");
      // The binary is not looked for again once it is known to be missing.
      expect(spawn).toHaveBeenCalledTimes(1);
   });

   it("warns again in the next run, which makes a formatter of its own", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const missing = Object.assign(new Error("spawn biome ENOENT"), { code: "ENOENT" });
      const spawn: SpawnFunction = () => ({ status: null, stdout: "", stderr: "", error: missing });

      createFormatter({ format: "biome", projectRoot }, spawn)?.(file, "x");
      createFormatter({ format: "biome", projectRoot }, spawn)?.(file, "x");

      expect(warn).toHaveBeenCalledTimes(2);
   });

   it("throws the stderr of a formatter that exits non-zero, naming the file", () => {
      const spawn = vi
         .fn<SpawnFunction>()
         .mockReturnValue({ status: 1, stdout: "", stderr: "  × expected `}`\n" });
      const format = createFormatter({ format: "prettier", projectRoot }, spawn);

      expect(() => format?.(file, "raw")).toThrowError(
         "The formatter 'prettier' failed on 'src/ipc/main.ts':\n× expected `}`",
      );
   });

   it("throws when the process cannot be run for another reason than a missing binary", () => {
      const denied = Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
      const spawn: SpawnFunction = () => ({ status: null, stdout: "", stderr: "", error: denied });
      const format = createFormatter({ format: "biome", projectRoot }, spawn);

      expect(() => format?.(file, "raw")).toThrowError(
         "The formatter 'biome' failed on 'src/ipc/main.ts':\nspawn EACCES",
      );
   });
});
