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

   it("does not import electron or chalk at runtime", () => {
      expect(runtimeImports.has("electron")).toBe(false);
      expect(runtimeImports.has("chalk")).toBe(false);
      expect(manifest.dependencies).not.toHaveProperty("chalk");
   });

   it("has no stale 'IpcAutomationPlugin' reference in the shipped types", () => {
      for (const file of ["types/index.d.ts", "types/internal.d.ts"]) {
         expect(fs.readFileSync(path.join(root, file), "utf8")).not.toContain(
            "IpcAutomationPlugin",
         );
      }
   });

   it("does not claim to use the TypeScript library in the README", () => {
      expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).not.toMatch(
         /uses the TypeScript library/i,
      );
   });
});
