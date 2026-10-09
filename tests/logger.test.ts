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

import logger from "@src/logger.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("logger", () => {
   let warnSpy: ReturnType<typeof vi.spyOn>;

   beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
   });
   afterEach(() => {
      vi.restoreAllMocks();
      Reflect.deleteProperty(global, "warnedIncorrectUsageOnce");
   });

   const output = () => String(warnSpy.mock.calls.at(-1)?.[0]);

   it("warns about a non-existent schema path", () => {
      logger.nonExistentSchemaPath("/p/schema.ts");
      expect(output()).toContain("schema path does not exist:");
      expect(output()).toContain("/p/schema.ts");
   });

   it("warns when no channel expressions were found", () => {
      logger.noChannelExpressions("/p/schema.ts");
      expect(output()).toContain("no channels were found in path:");
      expect(output()).toContain("/p/schema.ts");
   });

   it("prints clone warnings as one warning, one row per message", () => {
      logger.cloneWarnings(["first problem", "second problem"]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(output()).toContain("first problem");
      expect(output()).toContain("second problem");
   });

   it("prints nothing when there are no clone warnings", () => {
      logger.cloneWarnings([]);
      expect(warnSpy).not.toHaveBeenCalled();
   });

   it("prints a fatal error to stderr, one row per message line", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      logger.fatalError(new Error("first line\nsecond line"));
      logger.fatalError("plain text");
      const first = String(errorSpy.mock.calls[0][0]);
      expect(first).toContain("IPC automation failed:");
      expect(first).toContain("first line");
      expect(first).toContain("second line");
      expect(String(errorSpy.mock.calls[1][0])).toContain("plain text");
      expect(warnSpy).not.toHaveBeenCalled();
   });

   it("warns about executing channels only once", () => {
      logger.cannotExecuteChannels();
      logger.cannotExecuteChannels();
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(output()).toContain("have no effect when executed by JavaScript");
   });

   describe("reportSuccess", () => {
      const file = (fullPath: string, relativePath: string, channels = 1) =>
         ({
            fullPath,
            relativePath,
            specs: { channelSpecArray: Array.from({ length: channels }) },
         }) as never;

      it("reports paths relative to the project root, and others in full", () => {
         logger.reportSuccess(
            [
               file("/project/src/ipc/schema/user.ts", "./schema/user.ts", 2),
               file("/elsewhere/other.ts", "schema/missing.ts"),
            ],
            "/project",
         );
         expect(output()).toContain("Successfully generated IPC bindings:");
         expect(output()).toContain("2 channels from path 'src/ipc/schema/user.ts'");
         expect(output()).toContain("1 channels from path '/elsewhere/other.ts'");
      });

      // Regression for T71: the path was cut at the first occurrence of the data dir name,
      // which was found inside the name of the project directory.
      it("does not cut the path at a data dir name inside the project path", () => {
         logger.reportSuccess(
            [file("/work/automate-electron-ipc/ipc/schema.ts", "ipc")],
            "/work/automate-electron-ipc",
         );
         expect(output()).toContain("1 channels from path 'ipc/schema.ts'");
         expect(output()).not.toContain("ipc/ipc");
         expect(output()).not.toContain("automate-electron-ipc");
      });

      it("reports the full path when the project root is unknown", () => {
         logger.reportSuccess([file("/project/ipc/schema.ts", "ipc")]);
         expect(output()).toContain("1 channels from path '/project/ipc/schema.ts'");
      });

      it("does not treat a sibling directory with the same prefix as inside the project", () => {
         logger.reportSuccess([file("/project-two/ipc/schema.ts", "ipc")], "/project");
         expect(output()).toContain("path '/project-two/ipc/schema.ts'");
      });

      it("uses forward slashes for the relative path", () => {
         logger.reportSuccess([file("/project/a/b.ts", "b.ts")], "/project");
         expect(output()).toContain("path 'a/b.ts'");
      });
   });

   describe("staleFiles", () => {
      let errorSpy: ReturnType<typeof vi.spyOn>;
      beforeEach(() => {
         errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      });

      it("lists the stale files relative to the project root, one per line", () => {
         logger.staleFiles(["/project/ipc/main.ts", "/project/ipc/preload.ts"], "/project");
         const text = String(errorSpy.mock.calls[0][0]);
         expect(text).toContain("Generated files are out of date:");
         expect(text).toContain("ipc/main.ts\n");
         expect(text).toContain("ipc/preload.ts");
         expect(text).not.toContain("/project");
         expect(warnSpy).not.toHaveBeenCalled();
      });

      it("reports a path outside the project in full", () => {
         logger.staleFiles(["/elsewhere/main.ts"], "/project");
         expect(String(errorSpy.mock.calls[0][0])).toContain("/elsewhere/main.ts");
      });

      it("reports that the files are up to date when none is stale", () => {
         logger.staleFiles([], "/project");
         expect(output()).toContain("Generated files are up to date.");
         expect(errorSpy).not.toHaveBeenCalled();
      });
   });
});
