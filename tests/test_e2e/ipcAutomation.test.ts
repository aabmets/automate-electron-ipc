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
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { afterEach, describe, expect, it } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   await project?.cleanup();
   project = undefined;
});

describe("ipcAutomation, single schema file", () => {
   it("generates the three files from the channels of schema.ts", async () => {
      project = await runFixture("single-file");
      const { generated } = project;

      expect(generated["main.ts"]).toContain("getUser");
      expect(generated["main.ts"]).toContain("echoUserName");
      expect(generated["main.ts"]).toContain("windowFocused");
      expect(generated["preload.ts"]).toContain("sendEchoUserName");
      expect(generated["window.d.ts"]).toContain("sendEchoUserName");
      expect(generated["window.d.ts"]).toContain("User");
   });

   it("generates files that type-check", async () => {
      project = await runFixture("single-file");
      expect(await project.typecheck()).toBe("");
   });
});

describe("e2e harness", () => {
   // Regression for T50: `skipLibCheck` hid every error in the generated `window.d.ts`.
   it("reports errors in the generated window.d.ts", async () => {
      project = await runFixture("single-file");
      const windowTypes = path.join(project.dir, project.ipcDataDir, "window.d.ts");
      await fsp.appendFile(windowTypes, '\nimport type { Missing } from "./does-not-exist";\n');

      const diagnostics = await project.typecheck();
      expect(diagnostics).toContain("window.dts-check.ts");
      expect(diagnostics).toContain("does-not-exist");
   });

   it("leaves no helper file behind", async () => {
      project = await runFixture("single-file");
      await project.typecheck();
      const files = await fsp.readdir(path.join(project.dir, project.ipcDataDir));
      expect(files).not.toContain("window.dts-check.ts");
   });
});

describe("ipcAutomation, schema directory", () => {
   it("reads channels from nested files, without relying on Bun-only fs APIs", async () => {
      // Regression for B1: `fsp.exists` exists only in Bun, so directory mode threw on Node.
      const original = Object.getOwnPropertyDescriptor(fsp, "exists");
      Object.defineProperty(fsp, "exists", {
         configurable: true,
         value: () => {
            throw new TypeError("fsp.exists is not a function");
         },
      });
      try {
         project = await runFixture("schema-dir");
      } finally {
         if (original) {
            Object.defineProperty(fsp, "exists", original);
         } else {
            Reflect.deleteProperty(fsp, "exists");
         }
      }
      const { generated } = project;

      expect(generated["main.ts"]).toContain("getUser");
      expect(generated["main.ts"]).toContain("renameUser");
      expect(generated["main.ts"]).toContain("windowBlurred");
      expect(generated["preload.ts"]).toContain("sendRenameUser");
      expect(generated["window.d.ts"]).toContain("logStream");
   });

   // Regression for T08: a README, a JSON file and a `.d.ts` that repeats a channel name used
   // to be read from the schema directory.
   it("ignores files that are not schema sources", async () => {
      project = await runFixture("schema-dir");
      expect(project.generated["main.ts"].match(/getUser/g)).toHaveLength(1);
   });

   it("generates files that type-check", async () => {
      project = await runFixture("schema-dir");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, duplicate channels across files", () => {
   it("rejects the same channel name declared in two schema files", async () => {
      // Regression for B2: validation ran per file, so this produced duplicate keys in the output.
      await expect(runFixture("duplicate-channels")).rejects.toThrowError(
         /Channel name 'getUser' is declared in both '(a|b)\.ts' and '(a|b)\.ts'/,
      );
   });
});

describe("ipcAutomation, value imports used as types", () => {
   // Regression for B3: only `import type` names were recorded, so a class, enum, default or
   // aliased import that a signature referenced was missing from the generated files.
   it("imports every named, aliased, default and package import that a signature uses", async () => {
      project = await runFixture("value-imports");
      const { generated } = project;

      for (const file of ["main.ts", "window.d.ts"] as const) {
         expect(generated[file]).toContain('import type { Settings } from "./types/settings";');
         expect(generated[file]).toContain('import type { Mode } from "./types/settings";');
         expect(generated[file]).toContain(
            'import type { default as Profile } from "./types/profile";',
         );
         expect(generated[file]).toContain(
            'import type { Avatar as Picture } from "./types/profile";',
         );
         expect(generated[file]).toContain('import type { Rectangle } from "electron";');
      }
   });

   it("generates files that type-check", async () => {
      project = await runFixture("value-imports");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, namespace imports", () => {
   // Regression for T49: the second type from a namespace generated a bogus named import.
   it("imports the namespace once, however many of its types are used", async () => {
      project = await runFixture("namespace-imports");
      const { generated } = project;

      for (const file of ["main.ts", "window.d.ts"] as const) {
         const imports = generated[file].match(/^import type .*"\.\/types\/models";$/gm);
         expect(imports).toStrictEqual(['import type * as Models from "./types/models";']);
      }
   });

   it("generates files that type-check", async () => {
      project = await runFixture("namespace-imports");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, import order", () => {
   // Regression for T06: import lines followed the order of the schema files, so it depended
   // on the order that the files were read in.
   it("sorts the type imports of main.ts and window.d.ts", async () => {
      project = await runFixture("import-order");
      const { generated } = project;

      for (const file of ["main.ts", "window.d.ts"] as const) {
         const imports = generated[file].match(/^import type .*"\.\/types\/.*";$/gm);
         expect(imports).toStrictEqual([
            'import type { Alpha } from "./types/alpha";',
            'import type { Zeta } from "./types/zeta";',
         ]);
      }
   });

   it("generates files that type-check", async () => {
      project = await runFixture("import-order");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, schema without channels", () => {
   // Regression for T51: the empty window.d.ts had no import or export, so tsc rejected the
   // global augmentation with TS2669.
   it("generates an empty window.d.ts that is a module", async () => {
      project = await runFixture("no-channels");
      expect(project.generated["window.d.ts"]).toContain("export {};");
      expect(project.generated["window.d.ts"]).toContain("interface Window {}");
   });

   it("generates files that type-check", async () => {
      project = await runFixture("no-channels");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, schema with only port channels", () => {
   // Regression for T52: the empty callables line left a lone comma in main.ts and preload.ts.
   it("generates bindings without a dangling comma", async () => {
      project = await runFixture("port-only");
      const { generated } = project;

      expect(generated["main.ts"]).toContain("export const ipcMain = {\n   ports: {");
      expect(generated["preload.ts"]).toContain("exposeInMainWorld('ipc', {\n   ports: {");
      expect(generated["window.d.ts"]).toContain("ipc: {\n         ports: {");
      expect(generated["main.ts"]).not.toMatch(/\{\s*,/);
      expect(generated["preload.ts"]).not.toMatch(/\{\s*,/);
   });

   it("generates files that type-check", async () => {
      project = await runFixture("port-only");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, schema with a syntax error", () => {
   // Regression for T08: the parse error was swallowed and reported as "no channels found".
   it("rejects with the file path, line and column", async () => {
      await expect(runFixture("syntax-error")).rejects.toThrowError(
         /Syntax error in schema file '.*schema\.ts:4:\d+': /,
      );
   });
});
