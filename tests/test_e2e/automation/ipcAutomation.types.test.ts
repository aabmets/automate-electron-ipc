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

import { NODE_NEXT_OPTIONS } from "@testutils/e2e-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { describe, expect, it } from "vitest";

describe("ipcAutomation, type definition edge cases", () => {
   // Regression for T09: a non-exported helper type threw, a default exported interface was
   // imported by name, type parameters and globals were imported as custom types.
   it("imports only the user-defined types that channels use", async () => {
      const project = await fixtures.run("type-edge-cases");
      const { generated } = project;

      for (const file of ["main.ts", "window.d.ts"] as const) {
         const imports = generated[file].match(/^import type .*schema";$/gm);
         expect(imports).toStrictEqual([
            'import type { Box } from "./schema";',
            'import type { default as Payload } from "./schema";',
         ]);
         expect(generated[file]).not.toContain("Internal");
      }
      expect(generated["window.d.ts"]).toContain("invoke: <T>(value: T) => Promise<T>;");
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("type-edge-cases");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, types exported by specifiers and default classes", () => {
   // Regression for T61: `export { X }` failed validation, `export default class` got no import.
   it("imports the types under the names that the schema exports", async () => {
      const project = await fixtures.run("export-specifiers");
      const { generated } = project;

      for (const file of ["main.ts", "window.d.ts"] as const) {
         const imports = generated[file].match(/^import type .*schema";$/gm);
         expect(imports).toStrictEqual([
            'import type { Main as Primary } from "./schema";',
            'import type { Plain } from "./schema";',
            'import type { PublicRenamed as Renamed } from "./schema";',
            'import type { default as Account } from "./schema";',
         ]);
         expect(generated[file]).not.toContain("Hidden");
      }
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("export-specifiers");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, qualified names, typeof queries and destructuring", () => {
   // Regression for T54: `Kind.A` and `typeof config` produced no import. The renamed binding of
   // a destructured param is covered by the collectCustomTypes unit tests, since TypeScript
   // rejects such a binding in a function type.
   it("imports the heads of qualified names and typeof queries", async () => {
      const project = await fixtures.run("qualified-names");
      const { generated } = project;

      for (const file of ["main.ts", "window.d.ts"] as const) {
         const imports = generated[file].match(/^import type .*";$/gm) ?? [];
         expect(imports).toContain('import type { Kind } from "./types/kind";');
         expect(imports).toContain('import type { config } from "./types/config";');
         expect(imports).toContain('import type { Mode } from "./schema";');
         expect(imports).toContain('import type * as Shapes from "./types/shapes";');
         expect(imports).toContain('import type { Options } from "./schema";');
      }
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("qualified-names");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, decorators and import-equals in schema files", () => {
   // Regression for T90: swc parsed without `decorators: true`, so a decorated class was a
   // syntax error.
   it("parses a schema file with a decorated class", async () => {
      const project = await fixtures.run("decorators");
      expect(project.generated["main.ts"]).toContain("getUser");
      expect(await project.typecheck({ experimentalDecorators: false })).toBe("");
   });

   // Regression for T90: `export import User = Models.User` bound a name that no generated file
   // imported.
   it("imports the name of an exported import-equals alias from the schema file", async () => {
      const project = await fixtures.run("import-equals");
      for (const file of ["main.ts", "window.d.ts"] as const) {
         expect(project.generated[file]).toContain('import type { User } from "./schema";');
      }
      expect(await project.typecheck()).toBe("");
   });

   it("resolves an alias that is not exported to its target", async () => {
      const project = await fixtures.run("import-equals-local");
      const { generated } = project;
      expect(generated["main.ts"]).toContain("Promise<Models.User>");
      expect(generated["main.ts"]).toContain("point: Models.Shapes.Point");
      // The alias is no declaration of the schema file, so the generated files cannot import it.
      expect(generated["main.ts"]).not.toMatch(/import type \{[^}]*\bUser\b[^}]*\} from/);
      expect(generated["main.ts"]).not.toMatch(/import type \{[^}]*\bPoint\b[^}]*\} from/);
      expect(await project.typecheck()).toBe("");
   });

   it("keeps the aliases of two schema files apart when their targets share a name", async () => {
      const project = await fixtures.run("import-equals-local");
      const { generated } = project;
      expect(generated["main.ts"]).toContain('import type * as Models from "./types/models";');
      expect(generated["main.ts"]).toContain('import type * as Models_2 from "./types/other";');
      expect(generated["main.ts"]).toContain("Promise<Models_2.User>");
      expect(generated["window.d.ts"]).toContain("Promise<Models_2.User>");
   });

   it("imports the module of an import-equals require alias", async () => {
      const project = await fixtures.run("import-equals-require");
      const { generated } = project;
      expect(generated["main.ts"]).toContain('import type * as Models from "./models.js";');
      expect(generated["main.ts"]).toContain('import type { Exported } from "./schema.js";');
      // The require form is not valid in an ES module, so the fixture is a CommonJS project.
      expect(await project.typecheck(NODE_NEXT_OPTIONS)).toBe("");
   });
});

describe("ipcAutomation, typeof of values declared in the schema file", () => {
   // Regression for T62: `typeof config` of a value in the schema file got no import (TS2304).
   it("imports the exported values under the names that the schema exports", async () => {
      const project = await fixtures.run("typeof-local-values");
      const { generated } = project;

      for (const file of ["main.ts", "window.d.ts"] as const) {
         const imports = generated[file].match(/^import type .*schema";$/gm);
         expect(imports).toStrictEqual([
            'import type { Defaults as defaults } from "./schema";',
            'import type { config } from "./schema";',
            'import type { createUser } from "./schema";',
            'import type { default as main } from "./schema";',
         ]);
         expect(generated[file]).not.toContain("secret");
      }
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("typeof-local-values");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, schema types named like globals", () => {
   // Regression for T60: `Error`, `Map` and the like were treated as globals by name, so a schema
   // type of that name got no import and the generated files silently used the global type.
   const importLine = (text: string, exported: string, from: string): string | undefined =>
      new RegExp(`^import type \\{ ${exported}(?: as \\w+)? \\} from "${from}";$`, "m").exec(
         text,
      )?.[0];

   it("imports the declared and the imported types in main.ts", async () => {
      const project = await fixtures.run("shadowed-globals");
      const main = project.generated["main.ts"];

      // The generated `IpcForbiddenError` extends the global `Error`, so the schema type is aliased.
      expect(importLine(main, "Error", "./schema")).toBe(
         'import type { Error as Error_2 } from "./schema";',
      );
      expect(importLine(main, "Map", "./types/map")).toBe(
         'import type { Map } from "./types/map";',
      );
      expect(main).toContain(
         "(callback: (event: IpcMainEvent, error: Error_2) => void, options?: IpcListenOptions)",
      );
      // The global `Date` has no local binding and needs no import.
      expect(main).not.toMatch(/import type \{[^}]*\bDate\b/);
   });

   it("keeps a declared Promise apart from the one that the generated code uses", async () => {
      const project = await fixtures.run("shadowed-globals");
      const types = project.generated["window.d.ts"];

      expect(importLine(types, "Promise", "./schema")).toBe(
         'import type { Promise as Promise_2 } from "./schema";',
      );
      expect(types).toContain("Promise<Awaited<Promise_2<string>>>");
      expect(types).toContain("Promise<Awaited<Date>>");
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("shadowed-globals");
      expect(await project.typecheck()).toBe("");
   });
});
