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
import { transformSync } from "@swc/core";

async function compileFile(source: string): Promise<string> {
   return transformSync(await fsp.readFile(source, "utf8"), {
      jsc: { parser: { syntax: "typescript" }, target: "es2022" },
      module: { type: "commonjs" },
   }).code;
}

/**
 * Inlines the modules of the project that a script requires, as a bundler does for the preload
 * script of an app or of a service worker: a sandboxed preload can require `electron` and nothing else. The generated
 * script requires a module only for the serializer of the config.
 */
async function inlineLocalRequires(code: string, sourceFile: string): Promise<string> {
   const pattern = /require\("(\.{1,2}\/[^"]+)"\)/g;
   const inlined = await Promise.all(
      [...code.matchAll(pattern)].map(async (match) => {
         const file = path.resolve(path.dirname(sourceFile), `${match[1]}.ts`);
         const inner = await inlineLocalRequires(await compileFile(file), file);
         return {
            from: match[0],
            module: `(() => { const module = { exports: {} }; const exports = module.exports; ${inner}\n return module.exports; })()`,
         };
      }),
   );
   let result = code;
   for (const { from, module } of inlined) {
      result = result.replace(from, () => module);
   }
   return result;
}

export async function compileGenerated(ipcDir: string, outDir: string): Promise<void> {
   const entries = await fsp.readdir(ipcDir, { recursive: true, withFileTypes: true });
   const sources = entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"),
   );
   await Promise.all(
      sources.map(async (entry) => {
         const source = path.join(entry.parentPath, entry.name);
         let code = await compileFile(source);
         if (/^(service-worker-)?preload(\.[\w-]+)?\.ts$/.test(entry.name)) {
            code = await inlineLocalRequires(code, source);
         }
         if (/^preload(\.[\w-]+)?\.ts$/.test(entry.name)) {
            // The preload script is one file which only requires `electron`, as a sandboxed one must.
            // This tells the tests that it really runs sandboxed and in an isolated context.
            code += `\nrequire("electron").contextBridge.exposeInMainWorld("__env", { sandboxed: process.sandboxed, contextIsolated: process.contextIsolated });\n`;
         }
         const target = path.join(outDir, path.relative(ipcDir, source)).replace(/\.ts$/, ".js");
         await fsp.mkdir(path.dirname(target), { recursive: true });
         await fsp.writeFile(target, code);
      }),
   );
}
