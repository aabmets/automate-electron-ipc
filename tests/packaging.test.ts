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
import { builtinModules } from "node:module";
import path from "node:path";
import { parseSync } from "@swc/core";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function listSourceFiles(dir: string): string[] {
   return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).flatMap((entry) => {
      const full = path.join(entry.parentPath, entry.name);
      return entry.isFile() && full.endsWith(".ts") ? [full] : [];
   });
}

/** Package name of a bare specifier, or null for relative paths, builtins and tsconfig aliases. */
function packageNameOf(specifier: string): string | null {
   if (specifier.startsWith(".") || specifier.startsWith("node:") || specifier === "@types") {
      return null;
   }
   const [first, second] = specifier.split("/");
   const name = first?.startsWith("@") ? `${first}/${second}` : first;
   return name && !builtinModules.includes(name) ? name : null;
}

/** Packages that the library's own source imports at runtime (type-only imports are erased). */
function collectRuntimeImports(): Map<string, string[]> {
   const found = new Map<string, string[]>();
   for (const file of listSourceFiles(path.join(root, "src"))) {
      const module = parseSync(fs.readFileSync(file, "utf8"), {
         syntax: "typescript",
         target: "esnext",
      });
      for (const item of module.body) {
         const isImport = item.type === "ImportDeclaration" && !item.typeOnly;
         const isReExport =
            (item.type === "ExportNamedDeclaration" && !item.typeOnly && item.source) ||
            item.type === "ExportAllDeclaration";
         if (!(isImport || isReExport)) {
            continue;
         }
         const name = packageNameOf((item as { source: { value: string } }).source.value);
         if (name) {
            found.set(name, [...(found.get(name) ?? []), path.relative(root, file)]);
         }
      }
   }
   return found;
}

describe("package.json", () => {
   const runtimeImports = collectRuntimeImports();

   it("finds the known runtime imports of the generator", () => {
      expect([...runtimeImports.keys()]).toEqual(
         expect.arrayContaining(["@swc/core", "commander", "superstruct"]),
      );
   });

   it("declares every bare runtime import of src/ in dependencies", () => {
      const dependencies = Object.keys(manifest.dependencies ?? {});
      for (const [name, files] of runtimeImports) {
         expect(dependencies, `'${name}' is imported by ${files.join(", ")}`).toContain(name);
      }
   });

   it("declares only electron as a peer dependency, and marks it optional", () => {
      expect(Object.keys(manifest.peerDependencies ?? {})).toStrictEqual(["electron"]);
      expect(manifest.peerDependenciesMeta?.electron?.optional).toBe(true);
   });

   it("requires a Node version whose styleText supports the stream option", () => {
      // `styleText(..., { stream })` keeps colors off for non-TTY stderr since Node 22.13.
      expect(manifest.engines?.node).toBe(">=22.13.0");
   });

   it("does not import electron or chalk at runtime", () => {
      expect(runtimeImports.has("electron")).toBe(false);
      expect(runtimeImports.has("chalk")).toBe(false);
      expect(manifest.dependencies).not.toHaveProperty("chalk");
   });

   it("has no stale 'IpcAutomationPlugin' reference in the shipped types", () => {
      const files = fs.readdirSync(path.join(root, "types")).filter((f) => f.endsWith(".d.ts"));
      expect(files).toEqual(expect.arrayContaining(["index.d.ts", "internal.d.ts"]));
      for (const file of files) {
         expect(fs.readFileSync(path.join(root, "types", file), "utf8")).not.toContain(
            "IpcAutomationPlugin",
         );
      }
   });

   it("does not claim to use the TypeScript library in the README", () => {
      expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).not.toMatch(
         /uses the TypeScript library/i,
      );
   });

   describe("exports", () => {
      const tsconfig = JSON.parse(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8"));
      const entries = Object.entries(manifest.exports) as [
         string,
         { types: string; default: string },
      ][];

      it("lists the entry points of the package", () => {
         expect(entries.map(([key]) => key)).toEqual([".", "./api"]);
      });

      it.each(entries)("points the types of '%s' at a file that exists", (_key, target) => {
         expect(target.types).toMatch(/^\.\/types\/.+\.d\.ts$/);
         expect(fs.existsSync(path.join(root, target.types))).toBe(true);
      });

      it.each(entries)(
         "maps the default of '%s' to a source file that tsc emits there",
         (_key, target) => {
            const { rootDir, outDir } = tsconfig.compilerOptions;
            const outRelative = path.posix.relative(outDir, target.default);
            expect(outRelative.startsWith("..")).toBe(false);
            const source = path.posix.join(rootDir, outRelative.replace(/\.js$/, ".ts"));
            expect(outRelative.endsWith(".js")).toBe(true);
            expect(fs.existsSync(path.join(root, source))).toBe(true);
            expect(listSourceFiles(path.join(root, "src"))).toContain(path.join(root, source));
            expect(tsconfig.include).toContain("src/**/*");
         },
      );

      it("ships the files that the entry points name", () => {
         expect(manifest.files).toEqual(expect.arrayContaining(["dist", "types"]));
      });
   });
});
