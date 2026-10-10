import { NODE_NEXT_OPTIONS } from "@testutils/e2e-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { describe, expect, it } from "vitest";

describe("ipcAutomation, value imports used as types", () => {
   // Only `import type` names were recorded, so a class, enum, default or
   // aliased import that a signature referenced was missing from the generated files.
   it("imports every named, aliased, default and package import that a signature uses", async () => {
      const project = await fixtures.run("value-imports");
      const { generated } = project;

      for (const file of ["main.ts", "types.ts"] as const) {
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
      const project = await fixtures.run("value-imports");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, namespace imports", () => {
   // The second type from a namespace generated a bogus named import.
   it("imports the namespace once, however many of its types are used", async () => {
      const project = await fixtures.run("namespace-imports");
      const { generated } = project;

      for (const file of ["main.ts", "types.ts"] as const) {
         const imports = generated[file].match(
            /^import type (?!.*\bChannel(?:Map|Def)\b).*"\.\/types\/models";$/gm,
         );
         expect(imports).toStrictEqual(['import type * as Models from "./types/models";']);
      }
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("namespace-imports");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, import order", () => {
   // Import lines followed the order of the schema files, so it depended
   // on the order that the files were read in.
   it("sorts the type imports of main.ts and window.d.ts", async () => {
      const project = await fixtures.run("import-order");
      const { generated } = project;

      for (const file of ["main.ts", "types.ts"] as const) {
         const imports = generated[file].match(
            /^import type (?!.*\bChannel(?:Map|Def)\b).*"\.\/types\/.*";$/gm,
         );
         expect(imports).toStrictEqual([
            'import type { Alpha } from "./types/alpha";',
            'import type { Zeta } from "./types/zeta";',
         ]);
      }
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("import-order");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, import paths with dots in the file name", () => {
   // "./types/user.model" was imported as "./types/user" (TS2307).
   it("keeps the dotted file names, and maps script extensions for NodeNext", async () => {
      const project = await fixtures.run("dotted-imports");
      const { generated } = project;

      for (const file of ["main.ts", "types.ts"] as const) {
         expect(generated[file]).toContain('import type { User } from "./types/user.model.js";');
         expect(generated[file]).toContain('import type { Api } from "./types/api.v2.js";');
         expect(generated[file]).toContain('import type { Legacy } from "./types/legacy.js";');
      }
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("dotted-imports");
      expect(await project.typecheck()).toBe("");
   });

   it("generates files that resolve under NodeNext, which needs the script extensions", async () => {
      const project = await fixtures.run("dotted-imports");
      expect(await project.typecheck(NODE_NEXT_OPTIONS)).toBe("");
   });
});

describe("ipcAutomation, import paths of script extensions, JSON modules and import types", () => {
   // The extension of `api.mts` and of `./models.mjs` was dropped (TS2307).
   it("keeps .mjs for the .mts schema files and the .mjs specifiers", async () => {
      const project = await fixtures.run("script-extensions");
      for (const file of ["main.ts", "types.ts"] as const) {
         const imports =
            project.generated[file].match(/^import type (?!.*\bChannel(?:Map|Def)\b).*";$/gm) ?? [];
         expect(imports).toContain('import type { User } from "./schema/api.mjs";');
         expect(imports).toContain('import type { Account } from "./schema/models.mjs";');
      }
   });

   it("type-checks imports of .mts schema files and .mjs modules", async () => {
      const project = await fixtures.run("script-extensions");
      expect(await project.typecheck()).toBe("");
   });

   it("resolves imports of .mts schema files and .mjs modules under NodeNext", async () => {
      const project = await fixtures.run("script-extensions");
      expect(await project.typecheck(NODE_NEXT_OPTIONS)).toBe("");
   });

   // "./settings.json" became "./settings.json.js" under NodeNext.
   it("keeps the specifier of a JSON module under NodeNext, without a script extension", async () => {
      const project = await fixtures.run("json-import-node-next");
      for (const file of ["main.ts", "types.ts"] as const) {
         expect(project.generated[file]).toContain('from "./settings.json";');
         expect(project.generated[file]).not.toContain("settings.json.js");
      }
      expect(await project.typecheck({ ...NODE_NEXT_OPTIONS, resolveJsonModule: true })).toBe("");
   });

   // The path of `import("./models")` is relative to the schema file, and it
   // was copied as it is into the generated files, which are in another directory.
   it("rebases the path of an import type to the generated files", async () => {
      const project = await fixtures.run("inline-import-types");
      for (const file of ["main.ts", "types.ts"] as const) {
         expect(project.generated[file]).not.toContain('import("./models")');
         expect(project.generated[file]).toContain('import("./schema/models").User');
      }
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, directory imports, import-equals in namespaces and export =", () => {
   // "./models" became "./models.js" under NodeNext, which does not resolve
   // to "./models/index.ts".
   it("names the index file of a directory import under NodeNext", async () => {
      const project = await fixtures.run("directory-imports");
      for (const file of ["main.ts", "types.ts"] as const) {
         const imports =
            project.generated[file].match(/^import type (?!.*\bChannel(?:Map|Def)\b).*";$/gm) ?? [];
         expect(imports).toContain('import type { User } from "./models/index.js";');
         expect(imports).toContain('import type { Account } from "./models/index.js";');
         expect(imports).toContain('import type * as Shapes from "./shapes/index.js";');
         // A file of the same name wins over the directory.
         expect(imports).toContain('import type { FromFile } from "./both.js";');
         expect(project.generated[file]).toContain('import("./models/index.js").Account');
         expect(project.generated[file]).not.toContain("./models.js");
      }
      expect(await project.typecheck(NODE_NEXT_OPTIONS)).toBe("");
   });

   // "./models" became "./models.js", or named the index file, although the
   // package.json of the directory comes before it. Path mappings are kept as they are written.
   it("keeps package directories and path mappings under NodeNext", async () => {
      const project = await fixtures.run("directory-packages");
      for (const file of ["main.ts", "types.ts"] as const) {
         const imports =
            project.generated[file].match(/^import type (?!.*\bChannel(?:Map|Def)\b).*";$/gm) ?? [];
         expect(imports).toContain('import type { User } from "./models";');
         expect(imports).toContain('import type { Point } from "./plain/index.js";');
         expect(imports).toContain('import type { Circle } from "@ipc/shapes";');
         expect(imports).toContain('import type * as Aliased from "@ipc/models";');
         expect(project.generated[file]).toContain('import("./models").User');
         expect(project.generated[file]).not.toMatch(/models(\/index)?\.js/);
      }
      expect(project.generated["main.ts"]).toMatch(/^import \{ idArgs \} from "\.\/models";$/m);
      const paths = { "@ipc/*": ["./ipc/*"] };
      expect(await project.typecheck({ ...NODE_NEXT_OPTIONS, paths })).toBe("");
   });

   // The import-equals declarations of a namespace body are resolved by the compiler inside
   // the schema file, so a signature reaches them through the exported namespace.
   it("uses an import-equals alias that a namespace body declares", async () => {
      const project = await fixtures.run("import-equals-namespace");
      for (const file of ["main.ts", "types.ts"] as const) {
         expect(project.generated[file]).toContain('import type { Api } from "./schema";');
         expect(project.generated[file]).toContain("Promise<Api.User>");
         expect(project.generated[file]).toContain("Promise<Api.Reply>");
         expect(project.generated[file]).not.toMatch(/import type [^;]*\bModels\b/);
      }
      expect(await project.typecheck()).toBe("");
   });

   it("imports a module that has 'export =' with its namespace import", async () => {
      const project = await fixtures.run("export-equals");
      for (const file of ["main.ts", "types.ts"] as const) {
         const imports =
            project.generated[file].match(/^import type (?!.*\bChannel(?:Map|Def)\b).*";$/gm) ?? [];
         expect(imports).toContain('import type * as Models from "./models.js";');
         expect(imports).toContain('import type * as User from "./user.js";');
         expect(imports).toContain('import type { Exported } from "./schema.js";');
      }
      // `import X = require()` is not valid in an ES module, so the fixture is a CommonJS project.
      expect(await project.typecheck(NODE_NEXT_OPTIONS)).toBe("");
   });
});
