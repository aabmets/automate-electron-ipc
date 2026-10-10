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

import type * as t from "@types";
import { ImportPathResolver } from "./import-paths.js";
import { findAlias, findTarget, namedImport } from "./import-targets.js";

/** One import line of a generated file, shared by every schema file that refers to the type. */
interface Binding {
   /** The name that the generated file uses for the type. */
   local: string;
   /** Renders the import line for `local`. */
   render: (local: string) => string;
   emitted: boolean;
}

export class ImportsGenerator {
   private readonly paths: ImportPathResolver;
   private readonly bindings = new Map<string, Binding>();
   private readonly usedNames: Set<string>;
   private readonly resolved = new Map<string, Binding | null>();
   /** The names being resolved, which stops aliases that refer to one another. */
   private readonly resolving = new Set<string>();
   private readonly renames = new Map<string, Map<string, string>>();

   /**
    * `reservedNames` are the names that the generated file declares or imports itself, such as
    * `BrowserWindow`. A schema type of the same name is imported under an alias instead.
    */
   public constructor(
      projectUsesNodeNext: boolean,
      targetFilePath: string,
      reservedNames: Iterable<string> = [],
   ) {
      this.paths = new ImportPathResolver(projectUsesNodeNext, targetFilePath);
      this.usedNames = new Set(reservedNames);
   }

   /**
    * The specifier of an import type in a signature of the schema file, as written from the
    * generated file. Packages and aliases are kept.
    */
   public getImportTypePath(pfs: t.ParsedFileSpecs, fromPath: string): string {
      return this.paths.resolveImportPath(fromPath, pfs.fullPath);
   }

   /**
    * The import specifier of a source file in the project, as written from the generated file:
    * relative, and with the extension that the project's module resolution needs.
    */
   public getFileImportPath(filePath: string): string {
      return this.paths.fileImportPath(filePath);
   }

   /** The first name that is free in the generated file: `User`, then `User_2`, `User_3`... */
   private uniqueName(name: string): string {
      let candidate = name;
      let n = 2;
      while (this.usedNames.has(candidate)) {
         candidate = `${name}_${n}`;
         n++;
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
      const alias = findAlias(pfs, name);
      if (alias !== null) {
         return this.resolveAlias(pfs, name, alias, memoKey);
      }
      const target = findTarget(this.paths, pfs, name);
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
    * Resolves a name of `import X = Ns.Y` to the binding of the head of its target, and records
    * that the signatures use the target in place of the name: `Ns.Y`, or `Ns_2.Y` when the head
    * is imported under another name. The binding is the one of the target, since it is what the
    * generated file imports.
    */
   private resolveAlias(
      pfs: t.ParsedFileSpecs,
      name: string,
      target: string,
      memoKey: string,
   ): Binding | null {
      if (this.resolving.has(memoKey)) {
         return null;
      }
      this.resolving.add(memoKey);
      const head = target.split(".")[0];
      const binding = this.resolve(pfs, head);
      this.resolving.delete(memoKey);
      // The head may be an alias itself, which is renamed to its own target.
      const fileRenames = this.renames.get(pfs.fullPath) ?? new Map<string, string>();
      const replacement = `${fileRenames.get(head) ?? binding?.local ?? head}${target.slice(head.length)}`;
      if (replacement !== name) {
         fileRenames.set(name, replacement);
         this.renames.set(pfs.fullPath, fileRenames);
      }
      this.resolved.set(memoKey, binding);
      return binding;
   }

   /**
    * Binds the validator of a channel to a value import of the generated file, which is shared
    * by every channel that uses the same export of the same module. Returns the local name,
    * and the import line unless an earlier call returned it. The name is distinct from every
    * type and every reserved name of the file.
    */
   public getValueImport(
      pfs: t.ParsedFileSpecs,
      ref: t.ValidatorRef,
   ): { local: string; declaration: string | null } {
      const key = `${this.paths.moduleId(ref.fromPath, pfs.fullPath)}#value:${ref.exported}`;
      let binding = this.bindings.get(key);
      if (!binding) {
         const local = this.uniqueName(ref.name);
         this.usedNames.add(local);
         const fromPath = this.paths.resolveImportPath(ref.fromPath, pfs.fullPath);
         const render = (name: string) => {
            if (ref.exported === "default") {
               return `import ${name} from "${fromPath}";`;
            }
            const entry = ref.exported === name ? name : `${ref.exported} as ${name}`;
            return `import { ${entry} } from "${fromPath}";`;
         };
         binding = { local, render, emitted: false };
         this.bindings.set(key, binding);
      }
      const declaration = binding.emitted ? null : binding.render(binding.local);
      binding.emitted = true;
      return { local: binding.local, declaration };
   }

   /**
    * Binds the channel map of a schema file to a type-only import of the generated file, whose
    * `typeof` gives the signatures of its channels. Returns the local name, which is distinct from
    * every type and every reserved name of the file, and the import line unless an earlier call
    * returned it. Returns null for a file that has no exported channel map.
    */
   public getChannelMapImport(
      pfs: t.ParsedFileSpecs,
   ): { local: string; declaration: string | null } | null {
      const { channelMapExport } = pfs.specs;
      if (channelMapExport === null) {
         return null;
      }
      const filePath = this.paths.fileImportPath(pfs.fullPath);
      const key = `${this.paths.scriptId(pfs.fullPath)}#channelMap`;
      let binding = this.bindings.get(key);
      if (!binding) {
         const local = this.uniqueName("ChannelMap");
         this.usedNames.add(local);
         const render =
            channelMapExport.kind === "default"
               ? (name: string) => `import type ${name} from "${filePath}";`
               : namedImport(channelMapExport.name, filePath);
         binding = { local, render, emitted: false };
         this.bindings.set(key, binding);
      }
      const declaration = binding.emitted ? null : binding.render(binding.local);
      binding.emitted = true;
      return { local: binding.local, declaration };
   }

   /**
    * The names that the signatures of a schema file must use instead of the names they are
    * written with, because another declaration of the generated file has the same name.
    * Maps the written name to the name that the import declares.
    */
   public getRenames(pfs: t.ParsedFileSpecs): ReadonlyMap<string, string> {
      for (const spec of pfs.specs.channelSpecArray) {
         for (const customType of [
            ...spec.signature.customTypes,
            ...(spec.errors?.customTypes ?? []),
         ]) {
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
