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

import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { errorsMainLoader } from "@testutils/errors-main-utils.js";
import { afterEach, describe, expect, it } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   await project?.cleanup();
   project = undefined;
});

const loadMain = errorsMainLoader((created) => {
   project = created;
});

describe("fixture error-envelope", () => {
   it("generates files that type-check, including the declared error types", async () => {
      project = await runFixture("error-envelope");
      expect(await project.typecheck()).toBe("");
   });

   it("documents the declared error types of each invoke in window.d.ts", async () => {
      project = await runFixture("error-envelope");
      const types = project.generated["window.d.ts"];

      expect(types).toContain('import type { AuthError } from "./schema";');
      expect(types).toContain('import type { NotFoundError } from "./schema";');
      expect(types).toContain(
         "getUser: {\n      /** @throws {IpcError<NotFoundError | AuthError>} */\n      invoke:",
      );
      expect(types).toContain("deleteUser: {\n      /** @throws {IpcError<NotFoundError>} */");
      // The global error classes need no import.
      expect(types).toContain("/** @throws {IpcError<TypeError | RangeError>} */");
      expect(types).not.toMatch(/import type \{[^}]*(TypeError|RangeError)/);
      // A channel without declared errors rejects with the general shape.
      expect(types).toContain("getPlain: {\n      /** @throws {IpcError} */");
      // A send never rejects with a handler error.
      expect(types).toContain("ping: {\n      send: () => void;");
      expect(types).toContain("type IpcError<E extends Error = Error>");
   });

   it("fails the type-check when the declared errors do not match how they are used", async () => {
      project = await runFixture("error-envelope");
      const fsp = await import("node:fs/promises");
      const path = await import("node:path");
      const usage = path.join(project.dir, project.ipcDataDir, "schema-usage.ts");
      const text = await fsp.readFile(usage, "utf8");
      await fsp.writeFile(usage, text.replace("const id: number", "const id: string"));

      expect(await project.typecheck()).toContain("schema-usage.ts");
   });
});

describe("fixture raw-errors", () => {
   it("leaves the errors of the handlers to Electron when rawErrors is set", async () => {
      project = await runFixture("raw-errors");
      const { "main.ts": main, "preload.ts": preload, "window.d.ts": types } = project.generated;

      expect(main).not.toContain("settleInvoke");
      expect(main).not.toContain("IpcErrorInfo");
      expect(main).toContain("const listener = (event: IpcMainInvokeEvent, id: number) => {");
      expect(preload).toContain(
         "invoke: (...args: any[]) => ipcRenderer.invoke('autoipc:getUser', ...args),",
      );
      expect(types).not.toContain("IpcError");
      expect(types).not.toContain("@throws");
      expect(await project.typecheck()).toBe("");
   });

   it("registers the handler itself, so the reply is the value, not an envelope", async () => {
      const { handlerOf, ipc } = await loadMain("raw-errors");
      ipc.getPlain.handle(() => 7);

      expect(handlerOf("getPlain")({})).toBe(7);
   });

   it("declares no error type, and ignores the errors of a send", async () => {
      project = await runFixture("raw-errors");
      const { "main.ts": main, "window.d.ts": types } = project.generated;
      expect(main).not.toContain("toIpcError");
      expect(types).not.toContain("@throws");
      expect(types).not.toContain("IpcError");
      expect(types).toContain("ping: {\n      send: () => void;\n   };");
   });
});

describe("fixture error-collisions", () => {
   it("imports the error types of every channel under names that do not clash", async () => {
      project = await runFixture("error-collisions");
      const types = project.generated["window.d.ts"];

      expect(types).toContain('import type { Conflict } from "./errors/one";');
      expect(types).toContain('import type { Conflict as Conflict_2 } from "./errors/two";');
      expect(types).toContain('import type { Ok } from "./errors/one";');
      // Each channel names the declaration of its own schema file.
      expect(types).toContain("/** @throws {IpcError<Conflict | Ok>} */");
      expect(types).toContain("/** @throws {IpcError<Conflict_2>} */");
   });

   it("renames a schema type which would shadow the Error of the generated error type", async () => {
      project = await runFixture("error-collisions");
      const types = project.generated["window.d.ts"];

      expect(types).toContain('import type { Error as Error_2 } from "./schema/c";');
      expect(types).toContain("invoke: (error: Error_2) => Promise<void>;");
      expect(types).toContain("type IpcError<E extends Error = Error>");
      expect(await project.typecheck()).toBe("");
   });
});
