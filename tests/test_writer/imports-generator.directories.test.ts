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

import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImportsGenerator } from "@src/writer/imports-generator.js";
import type * as t from "@types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("ImportsGenerator", () => {
   describe("directory imports", () => {
      let root = "";
      beforeEach(() => {
         root = fs.mkdtempSync(path.join(tmpdir(), "vitest-dir-imports-"));
      });
      afterEach(() => {
         fs.rmSync(root, { recursive: true, force: true });
      });

      const touch = (...segments: string[]) => {
         const file = path.join(root, "ipc", ...segments);
         fs.mkdirSync(path.dirname(file), { recursive: true });
         fs.writeFileSync(file, "export {};\n");
      };
      const pfsOf = (...imports: string[]): t.ParsedFileSpecs => ({
         fullPath: path.join(root, "ipc/schema.ts"),
         relativePath: "",
         specs: {
            channelSpecArray: [],
            channelMapExport: null,
            importSpecArray: imports.map((fromPath, n) => ({
               fromPath,
               customTypes: [`Foo${n}`],
               namespace: null,
            })),
            typeSpecArray: [],
         },
      });
      const importOf = (fromPath: string, nodeNext: boolean) =>
         new ImportsGenerator(nodeNext, path.join(root, "ipc/main.ts")).getDeclaration(
            pfsOf(fromPath),
            "Foo0",
         );

      // Regression for T97: NodeNext does not resolve "./models.js" to "./models/index.ts".
      it("names the index file of a directory under NodeNext", () => {
         touch("models/index.ts");
         expect(importOf("./models", true)).toStrictEqual(
            'import type { Foo0 } from "./models/index.js";',
         );
         expect(importOf("./models/", true)).toStrictEqual(
            'import type { Foo0 } from "./models/index.js";',
         );
      });

      it("leaves a directory import alone when the project does not use NodeNext", () => {
         touch("models/index.ts");
         expect(importOf("./models", false)).toStrictEqual('import type { Foo0 } from "./models";');
      });

      it("names the module extension of the index file", () => {
         touch("esm/index.mts");
         touch("cjs/index.cts");
         touch("plain/index.js");
         expect(importOf("./esm", true)).toContain('"./esm/index.mjs"');
         expect(importOf("./cjs", true)).toContain('"./cjs/index.cjs"');
         expect(importOf("./plain", true)).toContain('"./plain/index.js"');
      });

      it("resolves the directory relative to the schema file", () => {
         touch("shared/models/index.ts");
         const generator = new ImportsGenerator(true, path.join(root, "out/main.ts"));
         expect(generator.getDeclaration(pfsOf("./shared/models"), "Foo0")).toStrictEqual(
            'import type { Foo0 } from "../ipc/shared/models/index.js";',
         );
      });

      it("prefers a file over a directory of the same name", () => {
         touch("both.ts");
         touch("both/index.ts");
         expect(importOf("./both", true)).toStrictEqual('import type { Foo0 } from "./both.js";');
      });

      it("keeps the specifier of a directory without an index file", () => {
         touch("empty/other.ts");
         expect(importOf("./empty", true)).toStrictEqual('import type { Foo0 } from "./empty.js";');
         expect(importOf("./missing", true)).toStrictEqual(
            'import type { Foo0 } from "./missing.js";',
         );
      });

      it("keeps a directory whose name has a data extension", () => {
         touch("data.json/index.ts");
         expect(importOf("./data.json", true)).toStrictEqual(
            'import type { Foo0 } from "./data.json";',
         );
      });

      it("imports a directory once, however it is spelled", () => {
         touch("models/index.ts");
         const pfs = pfsOf("./models", "./models/index", "./models/index.js");
         pfs.specs.importSpecArray = pfs.specs.importSpecArray.map((spec) => ({
            ...spec,
            customTypes: ["Foo"],
         }));
         const generator = new ImportsGenerator(true, path.join(root, "ipc/main.ts"));
         expect(generator.getDeclaration(pfs, "Foo")).toStrictEqual(
            'import type { Foo } from "./models/index.js";',
         );
         expect(generator.getRenames(pfs).size).toBe(0);
      });

      const writeManifest = (directory: string, manifest: string) => {
         fs.mkdirSync(path.join(root, "ipc", directory), { recursive: true });
         fs.writeFileSync(path.join(root, "ipc", directory, "package.json"), manifest);
      };

      // Regression for T101: "./models" became "./models.js", or named the index file, which the
      // package.json of the directory comes before.
      it.each(["types", "typings", "typesVersions", "main"])(
         "keeps a directory whose package.json has '%s' under NodeNext",
         (field) => {
            touch("models/index.ts");
            touch("models/lib/entry.ts");
            writeManifest("models", JSON.stringify({ [field]: "./lib/entry.js" }));
            expect(importOf("./models", true)).toStrictEqual(
               'import type { Foo0 } from "./models";',
            );
            expect(importOf("./models/", true)).toStrictEqual(
               'import type { Foo0 } from "./models";',
            );
         },
      );

      it("keeps a package directory without an index file", () => {
         touch("models/lib/entry.ts");
         writeManifest("models", '{ "main": "./lib/entry.js" }');
         expect(importOf("./models", true)).toStrictEqual('import type { Foo0 } from "./models";');
      });

      it("names the index file when the package.json does not name an entry point", () => {
         touch("plain/index.ts");
         touch("exported/index.ts");
         touch("broken/index.ts");
         touch("listed/index.ts");
         writeManifest("plain", '{ "name": "plain", "type": "commonjs" }');
         // `exports` does not apply to a relative specifier.
         writeManifest("exported", '{ "exports": "./lib/entry.js" }');
         writeManifest("broken", "{ not json");
         writeManifest("listed", '["main"]');
         for (const directory of ["plain", "exported", "broken", "listed"]) {
            expect(importOf(`./${directory}`, true)).toStrictEqual(
               `import type { Foo0 } from "./${directory}/index.js";`,
            );
         }
      });

      it("prefers a file over a package directory of the same name", () => {
         touch("both.ts");
         writeManifest("both", '{ "main": "./lib/entry.js" }');
         expect(importOf("./both", true)).toStrictEqual('import type { Foo0 } from "./both.js";');
      });

      it("rebases a package directory from the generated file", () => {
         writeManifest("shared/models", '{ "types": "./types.d.ts" }');
         const generator = new ImportsGenerator(true, path.join(root, "out/main.ts"));
         const pfs = pfsOf("./shared/models");
         expect(generator.getDeclaration(pfs, "Foo0")).toStrictEqual(
            'import type { Foo0 } from "../ipc/shared/models";',
         );
         expect(generator.getImportTypePath(pfs, "./shared/models/")).toStrictEqual(
            "../ipc/shared/models",
         );
      });

      it("imports a package directory once, however it is spelled", () => {
         writeManifest("models", '{ "main": "./lib/entry.js" }');
         const pfs = pfsOf("./models", "./models/");
         pfs.specs.importSpecArray = pfs.specs.importSpecArray.map((spec) => ({
            ...spec,
            customTypes: ["Foo"],
         }));
         const generator = new ImportsGenerator(true, path.join(root, "ipc/main.ts"));
         expect(generator.getDeclaration(pfs, "Foo")).toStrictEqual(
            'import type { Foo } from "./models";',
         );
         expect(generator.getRenames(pfs).size).toBe(0);
      });

      it("leaves a package directory alone when the project does not use NodeNext", () => {
         writeManifest("models", '{ "main": "./lib/entry.js" }');
         expect(importOf("./models", false)).toStrictEqual('import type { Foo0 } from "./models";');
      });

      it("resolves the directory of a namespace import and of an import type", () => {
         touch("shapes/index.ts");
         const pfs = pfsOf();
         pfs.specs.importSpecArray = [
            { fromPath: "./shapes", customTypes: [], namespace: "Shapes" },
         ];
         const generator = new ImportsGenerator(true, path.join(root, "ipc/main.ts"));
         expect(generator.getDeclaration(pfs, "Shapes.Point")).toStrictEqual(
            'import type * as Shapes from "./shapes/index.js";',
         );
         expect(generator.getImportTypePath(pfs, "./shapes")).toStrictEqual("./shapes/index.js");
      });
   });
});
