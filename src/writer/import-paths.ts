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
import path from "node:path";

const SCRIPT_EXTENSION = /\.(tsx?|mts|cts|jsx?|mjs|cjs)$/;

/**
 * The extension of the compiled file for each script extension. A specifier needs it under
 * NodeNext for every script, and under every resolution for the module scripts: `./a.mjs` is the
 * only spelling of `a.mts` that resolves.
 */
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

/**
 * The script extensions of the index file of a directory, in the order that TypeScript tries
 * them. The first one that exists names the file that `./models` stands for.
 */
const INDEX_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/**
 * The fields of the `package.json` of a directory that the compiler or Node resolve the directory
 * through, before its index file.
 */
const PACKAGE_ENTRY_FIELDS = ["types", "typings", "typesVersions", "main"];

/** A directory whose `package.json` names its entry point. */
const PACKAGE_DIRECTORY = Symbol("package directory");

/** What a directory specifier stands for: an index file, a package directory, or nothing. */
type DirectoryEntry = string | typeof PACKAGE_DIRECTORY | null;

/**
 * Extensions of the files that a schema file imports as they are, such as a JSON module. A
 * specifier with one is not extensionless, so NodeNext does not add `.js` to it. Other dots in
 * the file name, as in `user.model`, belong to the name.
 */
const DATA_EXTENSION =
   /\.(json|node|wasm|css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|html?|txt|md|csv|ya?ml|toml)$/i;

/**
 * Spells the import specifiers of a generated file: where the file is written decides how a path of a
 * schema file is written from it, and the module resolution of the project decides the extensions.
 */
export class ImportPathResolver {
   private readonly projectUsesNodeNext: boolean;
   private readonly targetFilePath: string;
   /** What a directory specifier stands for (see `directoryEntry`), by its absolute path. */
   private readonly directoryEntries = new Map<string, DirectoryEntry>();

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
    * replaced, by the extension of the compiled file. `.ts`, `.tsx`, `.js` and `.jsx` are
    * dropped unless the project uses NodeNext, which also adds `.js` to a path without an
    * extension. `.mts`, `.mjs`, `.cts` and `.cjs` are never dropped: they do not resolve without.
    */
   private getImportPath(...paths: string[]): string {
      const { base, ext } = this.splitScriptExtension(path.join(...paths));
      if (ext) {
         const output = SCRIPT_OUTPUT_EXTENSIONS[ext];
         return this.projectUsesNodeNext || output !== ".js" ? `${base}${output}` : base;
      }
      return this.projectUsesNodeNext && !DATA_EXTENSION.test(base) ? `${base}.js` : base;
   }

   /**
    * The specifier of a relative or non-relative path of an import in a schema file, as written from
    * the generated file. Packages and aliases are kept.
    */
   public resolveImportPath(fromPath: string, sourceFilePath: string): string {
      if (!fromPath.startsWith(".")) {
         // Packages and aliases do not depend on where the generated file is.
         return fromPath;
      }
      if (!this.projectUsesNodeNext) {
         return this.adjustImportPath(this.getImportPath(fromPath), sourceFilePath);
      }
      if (this.directoryEntry(fromPath, sourceFilePath) === PACKAGE_DIRECTORY) {
         // No one file path spells both the types and the code of the directory, so it is kept.
         return this.adjustImportPath(fromPath, sourceFilePath);
      }
      // NodeNext does not resolve a directory import, so the index file is named.
      const specifier = this.withDirectoryIndex(fromPath, sourceFilePath);
      return this.adjustImportPath(this.getImportPath(specifier), sourceFilePath);
   }

   /**
    * What the relative specifier `fromPath` of a source file stands for, when it has no script or
    * data extension and names a directory: the name of its index file (`index.ts`), or
    * `PACKAGE_DIRECTORY` when its `package.json` names the entry point. A file of the same name
    * wins over the directory, as it does in the compiler: `./models` is `models.ts` when both
    * exist. Returns null for anything else.
    *
    * The compiler and Node resolve a directory through its `package.json` before its index file,
    * but only in a CommonJS module, the only kind in which the schema file can import a directory.
    * The generated files resolve the specifier the same way there, the types through `types` and
    * the code through `main`, so it is kept. `exports` does not apply to a relative specifier.
    */
   private directoryEntry(fromPath: string, sourceFilePath: string): DirectoryEntry {
      const target = path.resolve(path.dirname(sourceFilePath), fromPath);
      const cached = this.directoryEntries.get(target);
      if (cached !== undefined) {
         return cached;
      }
      const isFile = (file: string) => fs.statSync(file, { throwIfNoEntry: false })?.isFile();
      let found: DirectoryEntry = null;
      if (
         !(SCRIPT_EXTENSION.test(target) || DATA_EXTENSION.test(target)) &&
         fs.statSync(target, { throwIfNoEntry: false })?.isDirectory() &&
         !INDEX_EXTENSIONS.some((ext) => isFile(`${target}${ext}`))
      ) {
         if (this.hasPackageEntry(target)) {
            found = PACKAGE_DIRECTORY;
         } else {
            const ext = INDEX_EXTENSIONS.find((candidate) =>
               isFile(path.join(target, `index${candidate}`)),
            );
            found = ext ? `index${ext}` : null;
         }
      }
      this.directoryEntries.set(target, found);
      return found;
   }

   /**
    * Whether the `package.json` of the directory has a field that the compiler or Node resolves
    * the directory through. One that cannot be read is ignored, as the compiler ignores it.
    */
   private hasPackageEntry(directory: string): boolean {
      let manifest: unknown;
      try {
         manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
      } catch {
         return false;
      }
      return (
         typeof manifest === "object" &&
         manifest !== null &&
         PACKAGE_ENTRY_FIELDS.some((field) => field in manifest)
      );
   }

   /** `fromPath`, followed by the index file when it names a directory that has one. */
   private withDirectoryIndex(fromPath: string, sourceFilePath: string): string {
      const entry = this.directoryEntry(fromPath, sourceFilePath);
      return entry && entry !== PACKAGE_DIRECTORY
         ? `${fromPath.replace(/\/+$/, "")}/${entry}`
         : fromPath;
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

   /**
    * The import specifier of a source file in the project, as written from the generated file:
    * relative, and with the extension that the project's module resolution needs.
    */
   public fileImportPath(filePath: string): string {
      return this.adjustImportPath(this.getImportPath(path.basename(filePath)), filePath);
   }

   /**
    * The base name of a script together with the kind of module it is, which spellings of the
    * same file share: `./a`, `./a.ts` and `./a.js`; `./a.mts` and `./a.mjs`; `./a.cts` and `./a.cjs`.
    */
   public scriptId(filePath: string): string {
      const { base, ext } = this.splitScriptExtension(filePath);
      const output = ext ? SCRIPT_OUTPUT_EXTENSIONS[ext] : ".js";
      return output === ".js" ? base : `${base}${output}`;
   }

   /** Identifies a module independently of how it is spelled. */
   public moduleId(fromPath: string, sourceFilePath: string): string {
      if (!fromPath.startsWith(".")) {
         return fromPath;
      }
      const specifier = this.withDirectoryIndex(fromPath, sourceFilePath);
      return this.scriptId(path.join(path.dirname(sourceFilePath), specifier)).replaceAll(
         path.sep,
         "/",
      );
   }
}
