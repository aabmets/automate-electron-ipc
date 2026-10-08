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

import path from "node:path";
import type * as t from "@types";

const SCRIPT_EXTENSION = /\.(tsx?|mts|cts|jsx?|mjs|cjs)$/;

/** The extension of the compiled file for each script extension, as NodeNext imports need it. */
const SCRIPT_OUTPUT_EXTENSIONS: Record<string, string> = {
   ts: ".js",
   tsx: ".js",
   js: ".js",
   jsx: ".js",
   mts: ".mjs",
   mjs: ".mjs",
   cts: ".cjs",
   cjs: ".cjs",
};

/** One import line of a generated file, shared by every schema file that refers to the type. */
interface Binding {
   /** The name that the generated file uses for the type. */
   local: string;
   /** Renders the import line for `local`. */
   render: (local: string) => string;
   emitted: boolean;
}

/** What a name in a signature stands for, before a local name in the generated file is chosen. */
interface Target {
   /** Identifies the declaration: the module that it lives in and the name it is exported under. */
   key: string;
   render: (local: string) => string;
}

export class ImportsGenerator {
   private readonly projectUsesNodeNext: boolean;
   private readonly targetFilePath: string;
   private readonly bindings = new Map<string, Binding>();
   private readonly usedNames = new Set<string>();
   private readonly resolved = new Map<string, Binding | null>();
   private readonly renames = new Map<string, Map<string, string>>();

   public constructor(projectUsesNodeNext: boolean, targetFilePath: string) {
      this.projectUsesNodeNext = projectUsesNodeNext;
      this.targetFilePath = targetFilePath;
   }

   /**
    * Splits a source file path into its base name and its script extension, if it has one.
    * Dots in a file name such as `user.model` belong to the name and are kept.
    */
   private splitScriptExtension(filePath: string): { base: string; ext: string | null } {
      const normalizedPath = filePath.replaceAll(path.sep, "/");
      const match = SCRIPT_EXTENSION.exec(normalizedPath);
      return match
         ? { base: normalizedPath.slice(0, match.index), ext: match[1] }
         : { base: normalizedPath, ext: null };
   }

   /**
    * Turns the path of a source file into an import specifier. Only script extensions are
    * replaced: with NodeNext by the extension of the compiled file, otherwise they are dropped.
    */
   private getImportPath(...paths: string[]): string {
      const { base, ext } = this.splitScriptExtension(path.join(...paths));
      return this.projectUsesNodeNext
         ? `${base}${ext ? SCRIPT_OUTPUT_EXTENSIONS[ext] : ".js"}`
         : base;
   }

   private resolveImportPath(fromPath: string, sourceFilePath: string): string {
      if (!fromPath.startsWith(".")) {
         // Packages and aliases do not depend on where the generated file is.
         return fromPath;
      }
      return this.adjustImportPath(this.getImportPath(fromPath), sourceFilePath);
   }

   private adjustImportPath(importPath: string, sourceFilePath: string): string {
      const sourceDir = path.dirname(sourceFilePath);
      const targetDir = path.dirname(this.targetFilePath);
      const importAbsolutePath = path.normalize(path.join(sourceDir, importPath));
      let adjustedPath = path.relative(targetDir, importAbsolutePath);
      adjustedPath = adjustedPath.replace(/\\/g, "/");
      if (!["..", "./"].includes(adjustedPath.slice(0, 2))) {
         adjustedPath = `./${adjustedPath}`;
      }
      return adjustedPath;
   }

   /** Identifies a module independently of how it is spelled: `./a`, `./a.ts` and `./a.js`. */
   private moduleId(fromPath: string, sourceFilePath: string): string {
      if (!fromPath.startsWith(".")) {
         return fromPath;
      }
      const { base } = this.splitScriptExtension(fromPath);
      return path.join(path.dirname(sourceFilePath), base).replaceAll(path.sep, "/");
   }

   /**
    * Finds what a name used in a signature of the schema file refers to: a namespace import,
    * a type that the schema file declares or a named import. Returns null for unknown names.
    */
   private findTarget(pfs: t.ParsedFileSpecs, name: string): Target | null {
      const { importSpecArray, typeSpecArray } = pfs.specs;
      const nsSpec = importSpecArray.find((spec) => spec.namespace === name);
      if (nsSpec) {
         const nsPath = this.resolveImportPath(nsSpec.fromPath, pfs.fullPath);
         return {
            key: `${this.moduleId(nsSpec.fromPath, pfs.fullPath)}*`,
            render: (local) => `import type * as ${local} from "${nsPath}";`,
         };
      }
      const typeSpec = typeSpecArray.find((spec) => spec.name === name);
      if (typeSpec) {
         const exported = typeSpec.isDefault ? "default" : name;
         const fileName = path.basename(pfs.fullPath);
         const filePath = this.adjustImportPath(this.getImportPath(fileName), pfs.fullPath);
         const fileId = this.splitScriptExtension(pfs.fullPath).base;
         return { key: `${fileId}#${exported}`, render: this.namedImport(exported, filePath) };
      }
      // Entries are `Foo`, `Foo as Bar` or `default as Foo`. The local name is what signatures use.
      for (const spec of importSpecArray) {
         for (const entry of spec.customTypes) {
            const [exported, local = exported] = entry.split(" as ");
            if (local === name) {
               const fromPath = this.resolveImportPath(spec.fromPath, pfs.fullPath);
               const key = `${this.moduleId(spec.fromPath, pfs.fullPath)}#${exported}`;
               return { key, render: this.namedImport(exported, fromPath) };
            }
         }
      }
      return null;
   }

   private namedImport(exported: string, fromPath: string): (local: string) => string {
      return (local) => {
         const entry = exported === local ? local : `${exported} as ${local}`;
         return `import type { ${entry} } from "${fromPath}";`;
      };
   }

   /** The first name that is free in the generated file: `User`, then `User_2`, `User_3`... */
   private uniqueName(name: string): string {
      let candidate = name;
      for (let n = 2; this.usedNames.has(candidate); n++) {
         candidate = `${name}_${n}`;
      }
      return candidate;
   }

   /**
    * Binds a name of a signature to an import of the generated file. Every declaration is
    * imported once, however many schema files refer to it, and two declarations that share a
    * name are imported under distinct names, which are recorded as renames of the schema file.
    */
   private resolve(pfs: t.ParsedFileSpecs, parsedCustomType: string): Binding | null {
      // A qualified name such as `Kind.A` or `typeof config.key` is imported through its head.
      const name = parsedCustomType.split(".")[0];
      const memoKey = `${pfs.fullPath}\0${name}`;
      if (this.resolved.has(memoKey)) {
         return this.resolved.get(memoKey) ?? null;
      }
      const target = this.findTarget(pfs, name);
      let binding: Binding | null = null;
      if (target) {
         binding = this.bindings.get(target.key) ?? null;
         if (!binding) {
            const local = this.uniqueName(name);
            this.usedNames.add(local);
            binding = { local, render: target.render, emitted: false };
            this.bindings.set(target.key, binding);
         }
         if (binding.local !== name) {
            const fileRenames = this.renames.get(pfs.fullPath) ?? new Map<string, string>();
            fileRenames.set(name, binding.local);
            this.renames.set(pfs.fullPath, fileRenames);
         }
      }
      this.resolved.set(memoKey, binding);
      return binding;
   }

   /**
    * The names that the signatures of a schema file must use instead of the names they are
    * written with, because another declaration of the generated file has the same name.
    * Maps the written name to the name that the import declares.
    */
   public getRenames(pfs: t.ParsedFileSpecs): ReadonlyMap<string, string> {
      for (const spec of pfs.specs.channelSpecArray) {
         for (const customType of spec.signature.customTypes) {
            this.resolve(pfs, customType);
         }
      }
      return this.renames.get(pfs.fullPath) ?? new Map();
   }

   /**
    * Returns the import line for a type of a signature, or null when the type needs no import
    * or the generated file imports it already.
    */
   public getDeclaration(
      parsedFileSpecs: t.ParsedFileSpecs,
      parsedCustomType: string,
   ): string | null {
      const binding = this.resolve(parsedFileSpecs, parsedCustomType);
      if (!binding || binding.emitted) {
         return null;
      }
      binding.emitted = true;
      return binding.render(binding.local);
   }
}
