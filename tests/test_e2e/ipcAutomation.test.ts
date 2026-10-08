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
import { afterEach, describe, expect, it, vi } from "vitest";

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
         /Channel name 'getUser' is declared in both 'a\.ts' and 'b\.ts'\. /,
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

describe("ipcAutomation, workspace", () => {
   // Regression for T07: the project root was the first .git above the library, which is the
   // repo root of a workspace. The root package.json here points at a different, wrong dir.
   it("generates into the app package when run from one of its sub-directories", async () => {
      project = await runFixture("workspace", {
         project: "packages/app",
         cwd: "packages/app/src/main",
      });

      expect(project.generated["main.ts"]).toContain("getUser");
      expect(project.generated["preload.ts"]).toContain("sendEchoUserName");
      expect(project.generated["window.d.ts"]).toContain("User");
      await expect(fsp.stat(path.join(project.root, "wrong"))).rejects.toThrowError();
      await expect(
         fsp.stat(path.join(project.root, "packages/app/src/main/ipc")),
      ).rejects.toThrowError();
   });

   it("generates files that type-check", async () => {
      project = await runFixture("workspace", { project: "packages/app" });
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, wrapped channel map export", () => {
   // Regression for T58: `export default defineChannels({...}) satisfies X` was rejected.
   it("generates bindings for a map followed by satisfies", async () => {
      project = await runFixture("export-forms");
      expect(project.generated["main.ts"]).toContain("getUser");
      expect(project.generated["preload.ts"]).toContain("sendEchoUserName");
   });

   it("generates files that type-check", async () => {
      project = await runFixture("export-forms");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, type definition edge cases", () => {
   // Regression for T09: a non-exported helper type threw, a default exported interface was
   // imported by name, type parameters and globals were imported as custom types.
   it("imports only the user-defined types that channels use", async () => {
      project = await runFixture("type-edge-cases");
      const { generated } = project;

      for (const file of ["main.ts", "window.d.ts"] as const) {
         const imports = generated[file].match(/^import type .*schema";$/gm);
         expect(imports).toStrictEqual([
            'import type { Box } from "./schema";',
            'import type { default as Payload } from "./schema";',
         ]);
         expect(generated[file]).not.toContain("Internal");
      }
      expect(generated["window.d.ts"]).toContain("sendEcho: <T>(value: T) => Promise<T>;");
   });

   it("generates files that type-check", async () => {
      project = await runFixture("type-edge-cases");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, types exported by specifiers and default classes", () => {
   // Regression for T61: `export { X }` failed validation, `export default class` got no import.
   it("imports the types under the names that the schema exports", async () => {
      project = await runFixture("export-specifiers");
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
      project = await runFixture("export-specifiers");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, import paths with dots in the file name", () => {
   // Regression for T55: "./types/user.model" was imported as "./types/user" (TS2307).
   it("keeps the dotted file names, and maps script extensions for NodeNext", async () => {
      project = await runFixture("dotted-imports");
      const { generated } = project;

      for (const file of ["main.ts", "window.d.ts"] as const) {
         expect(generated[file]).toContain('import type { User } from "./types/user.model.js";');
         expect(generated[file]).toContain('import type { Api } from "./types/api.v2.js";');
         expect(generated[file]).toContain('import type { Legacy } from "./types/legacy.js";');
      }
   });

   it("generates files that type-check", async () => {
      project = await runFixture("dotted-imports");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, qualified names, typeof queries and destructuring", () => {
   // Regression for T54: `Kind.A` and `typeof config` produced no import. The renamed binding of
   // a destructured param is covered by the collectCustomTypes unit tests, since TypeScript
   // rejects such a binding in a function type.
   it("imports the heads of qualified names and typeof queries", async () => {
      project = await runFixture("qualified-names");
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
      project = await runFixture("qualified-names");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, typeof of values declared in the schema file", () => {
   // Regression for T62: `typeof config` of a value in the schema file got no import (TS2304).
   it("imports the exported values under the names that the schema exports", async () => {
      project = await runFixture("typeof-local-values");
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
      project = await runFixture("typeof-local-values");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, type names that collide across schema files", () => {
   // Regression for T53: imports were deduped by local name only, so two `User` types were
   // either declared twice (TS2300) or the second one was dropped and its channels used the first.

   /** The name under which the generated file imports `exported` from `from`. */
   const importedAs = (text: string, exported: string, from: string): string => {
      const line = new RegExp(
         `^import type \\{ ${exported}(?: as (\\w+))? \\} from "${from}";$`,
         "m",
      );
      const match = line.exec(text);
      if (!match) {
         throw new Error(`No import of ${exported} from ${from} in:\n${text}`);
      }
      return match[1] ?? exported;
   };
   const lineOf = (text: string, member: string): string => {
      return text.split("\n").find((line) => line.includes(`${member}:`)) ?? "";
   };

   it("imports types of the same name that are declared in two schema files under distinct names", async () => {
      project = await runFixture("name-collisions");
      const { generated } = project;

      for (const file of ["main.ts", "window.d.ts"] as const) {
         const userB = importedAs(generated[file], "User", "./schema/b");
         const userC = importedAs(generated[file], "User", "./schema/c");
         expect(userB).not.toBe(userC);

         const member = file === "main.ts" ? "onGetUser" : "sendGetUser";
         expect(lineOf(generated[file], `${member}B`)).toContain(`Promise<${userB}>`);
         expect(lineOf(generated[file], `${member}C`)).toContain(`Promise<${userC}>`);
      }
   });

   it("keeps an imported type and a declared type of the same name apart", async () => {
      project = await runFixture("name-collisions");
      const { generated } = project;

      for (const file of ["main.ts", "window.d.ts"] as const) {
         const imported = importedAs(generated[file], "User", "./types/user");
         const declared = importedAs(generated[file], "User", "./schema/b");
         expect(imported).not.toBe(declared);

         const member = file === "main.ts" ? "onGetUser" : "sendGetUser";
         expect(lineOf(generated[file], `${member}A`)).toContain(`Promise<${imported}>`);
         expect(lineOf(generated[file], `${member}B`)).toContain(`Promise<${declared}>`);
      }
      // Three declarations are called User: they get User, User_2 and User_3.
      const names = new Set(
         ["./types/user", "./schema/b", "./schema/c"].map((from) =>
            importedAs(generated["window.d.ts"], "User", from),
         ),
      );
      expect(names).toStrictEqual(new Set(["User", "User_2", "User_3"]));
   });

   it("imports namespaces of the same alias from different modules under distinct aliases", async () => {
      project = await runFixture("name-collisions");
      const { generated } = project;

      for (const file of ["main.ts", "window.d.ts"] as const) {
         const text = generated[file];
         const aliasOf = (from: string) =>
            new RegExp(`^import type \\* as (\\w+) from "${from}";$`, "m").exec(text)?.[1];
         const one = aliasOf("./types/one");
         const two = aliasOf("./types/two");
         expect(one).toBeDefined();
         expect(two).toBeDefined();
         expect(one).not.toBe(two);

         const member = file === "main.ts" ? "onGetItem" : "sendGetItem";
         expect(lineOf(text, `${member}A`)).toContain(`Promise<${one}.Item>`);
         expect(lineOf(text, `${member}B`)).toContain(`Promise<${two}.Item>`);
      }
   });

   it("injects the event and repeats type params after a renamed type param bound", async () => {
      // Regression for the T53/T57 combination: renaming `User` to `User_3` lengthened the
      // text before the parameter list, so `paramsStart` pointed into the wrong place.
      project = await runFixture("name-collisions");
      const main = project.generated["main.ts"];
      const userC = importedAs(main, "User", "./schema/c");
      expect(userC).not.toBe("User");

      expect(lineOf(main, "onFindUserC")).toContain(
         `(callback: <T extends ${userC}>(event: IpcMainInvokeEvent, user: T) => Promise<T>)`,
      );
      expect(main).toContain(
         `<T extends ${userC}>(event: IpcMainInvokeEvent, user: T) => callback(event, user)`,
      );
      expect(lineOf(main, "sendPushUserC")).toContain(
         `<T extends ${userC}>(browserWindow: BrowserWindow, user: T)`,
      );
   });

   it("imports a type that two schema files import once", async () => {
      project = await runFixture("name-collisions");
      for (const file of ["main.ts", "window.d.ts"] as const) {
         const imports = project.generated[file].match(/^import type .*"\.\/types\/shared";$/gm);
         expect(imports).toStrictEqual(['import type { Shared } from "./types/shared";']);
      }
   });

   it("generates files that type-check", async () => {
      project = await runFixture("name-collisions");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, schema types named like generated names", () => {
   // Regression for T59: a schema type called `BrowserWindow`, `Window` or `IpcMainEvent` was
   // imported under that name and clashed with the declaration of the generated file (TS2300).
   const importLine = (text: string, exported: string, from: string): string | undefined =>
      new RegExp(`^import type \\{ ${exported}(?: as \\w+)? \\} from "${from}";$`, "m").exec(
         text,
      )?.[0];

   it("imports the schema types under aliases in main.ts", async () => {
      project = await runFixture("reserved-names");
      const main = project.generated["main.ts"];

      expect(main).toContain(
         'import type { IpcMainInvokeEvent, IpcMainEvent, BrowserWindow } from "electron";',
      );
      expect(importLine(main, "BrowserWindow", "./schema")).toBe(
         'import type { BrowserWindow as BrowserWindow_2 } from "./schema";',
      );
      expect(importLine(main, "Window", "./schema")).toBe(
         'import type { Window } from "./schema";',
      );
      expect(importLine(main, "IpcMainEvent", "./types/events")).toBe(
         'import type { IpcMainEvent as IpcMainEvent_2 } from "./types/events";',
      );
      // The schema type is used in the signatures, the Electron type in the generated wrapper.
      expect(main).toContain("(callback: (event: IpcMainEvent, options: BrowserWindow_2) => void)");
      expect(main).toContain("(browserWindow: BrowserWindow, event: IpcMainEvent_2)");
   });

   it("imports the schema types under aliases in window.d.ts", async () => {
      project = await runFixture("reserved-names");
      const types = project.generated["window.d.ts"];

      expect(importLine(types, "Window", "./schema")).toBe(
         'import type { Window as Window_2 } from "./schema";',
      );
      expect(types).toContain("Promise<Window_2>");
      expect(types).toContain("export default Window;");
   });

   it("generates files that type-check", async () => {
      project = await runFixture("reserved-names");
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
      project = await runFixture("shadowed-globals");
      const main = project.generated["main.ts"];

      expect(importLine(main, "Error", "./schema")).toBe('import type { Error } from "./schema";');
      expect(importLine(main, "Map", "./types/map")).toBe(
         'import type { Map } from "./types/map";',
      );
      expect(main).toContain("(callback: (event: IpcMainEvent, error: Error) => void)");
      // The global `Date` has no local binding and needs no import.
      expect(main).not.toMatch(/import type \{[^}]*\bDate\b/);
   });

   it("keeps a declared Promise apart from the one that the generated code uses", async () => {
      project = await runFixture("shadowed-globals");
      const types = project.generated["window.d.ts"];

      expect(importLine(types, "Promise", "./schema")).toBe(
         'import type { Promise as Promise_2 } from "./schema";',
      );
      expect(types).toContain("Promise<Awaited<Promise_2<string>>>");
      expect(types).toContain("Promise<Awaited<Date>>");
   });

   it("generates files that type-check", async () => {
      project = await runFixture("shadowed-globals");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, generated file start", () => {
   // Regression for T65: every generated file started with a blank line.
   it.each(["single-file", "no-channels", "port-only"])(
      "starts every generated file of '%s' with the notice",
      async (fixture) => {
         project = await runFixture(fixture);
         for (const contents of Object.values(project.generated)) {
            expect(contents.startsWith("// NOTICE: THIS FILE WAS GENERATED")).toBe(true);
            expect(contents).not.toMatch(/\n\n\n/);
         }
      },
   );
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

   // Regression for T65: main.ts imported `ipcMain` without using it.
   it("imports nothing unused, so the files type-check under noUnusedLocals", async () => {
      project = await runFixture("port-only");
      expect(project.generated["main.ts"]).not.toContain("electronIpcMain");
      expect(project.generated["main.ts"]).toContain(
         'import { MessageChannelMain } from "electron";',
      );
      expect(await project.typecheck({ noUnusedLocals: true })).toBe("");
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

describe("ipcAutomation, handler and sender types", () => {
   // Regression for B6 and B7: `handle` listeners got the wrong event type, and Broadcast
   // senders were typed as promises although `ipcRenderer.send` returns `undefined`.
   it("types Unicast handlers with IpcMainInvokeEvent and Broadcast ones with IpcMainEvent", async () => {
      project = await runFixture("handler-types");
      const main = project.generated["main.ts"];

      expect(main).toContain('import type { IpcMainInvokeEvent, IpcMainEvent } from "electron";');
      expect(main).toContain("onGetUser: (callback: (event: IpcMainInvokeEvent, id: number)");
      expect(main).toContain("(event: IpcMainInvokeEvent, id: number) => callback(event, id)");
      expect(main).toContain("onEcho: (callback: (event: IpcMainEvent, text: string,");
      expect(main).toContain("(event: IpcMainEvent, text: string, ...rest: number[]) =>");
      expect(main).toContain("callback(event, text, ...rest)");
      expect(main).not.toContain("any");
   });

   it("types Broadcast senders as void and Unicast senders as promises", async () => {
      project = await runFixture("handler-types");
      const windowTypes = project.generated["window.d.ts"];

      expect(windowTypes).toContain("sendEcho: (text: string, ...rest: number[]) => void;");
      expect(windowTypes).toContain("sendPing: (text: string) => void;");
      expect(windowTypes).toContain("sendGetUser: (id: number) => Promise<string>;");
   });

   it("generates files that type-check against the declared signatures", async () => {
      project = await runFixture("handler-types");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, rest, optional and destructured parameters", () => {
   // Regression for B4: the sender dropped the spread, so `webContents.send` received one array.
   it("forwards rest parameters with their spread", async () => {
      project = await runFixture("param-shapes");
      const main = project.generated["main.ts"];

      expect(main).toContain("(browserWindow: BrowserWindow, label: string, ...values: number[])");
      expect(main).toContain("browserWindow.webContents.send('restSum', label, ...values)");
      expect(main).toContain("browserWindow.webContents.send('optionalFlag', label, flag)");
      expect(main).toContain("(browserWindow: BrowserWindow, arg0: Point, arg1: [number, number])");
      expect(main).toContain("browserWindow.webContents.send('destructured', arg0, arg1)");
   });

   it("generates files that type-check", async () => {
      project = await runFixture("param-shapes");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, non-ASCII schema source", () => {
   const lineOf = (text: string, member: string): string => {
      return text.split("\n").find((line) => line.includes(`${member}:`)) ?? "";
   };

   // Regression for T66: swc spans are UTF-8 byte offsets, so non-ASCII text (and a BOM) in front
   // of a signature shifted every later slice and garbled the generated signatures.
   it("generates intact signatures from a schema with a BOM and non-ASCII text", async () => {
      project = await runFixture("non-ascii");
      const { generated } = project;
      expect(await fsp.readFile(path.join(project.dir, "ipc/schema.ts"), "utf8")).toMatch(
         /^\uFEFF/,
      );

      expect(lineOf(generated["main.ts"], "onGetÜser")).toContain(
         '(callback: (event: IpcMainInvokeEvent, id: "ñ", size: Größe) => Promise<Üser>)',
      );
      expect(generated["main.ts"]).toContain(
         `electronIpcMain.handle('generic', <T extends "ü" = "ü">(event: IpcMainInvokeEvent, arg: T) => callback(event, arg))`,
      );
      expect(lineOf(generated["window.d.ts"], "sendGetÜser")).toContain(
         '(id: "ñ", size: Größe) => Promise<Üser>',
      );
      expect(lineOf(generated["window.d.ts"], "sendGreet")).toContain(
         '(message: "héllo 😀") => void',
      );
      expect(generated["window.d.ts"]).toContain('import type { Größe } from "./schema";');
      expect(generated["window.d.ts"]).toContain('import type { Üser } from "./schema";');
   });

   it("generates files that type-check", async () => {
      project = await runFixture("non-ascii");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, locale-independent output order", () => {
   // Regression for T67: members were ordered with `localeCompare`, which depends on the locale
   // of the process and compared the whole callable, so `sendItem` and `sendItem2` swapped places.
   const members = (text: string): string[] =>
      Array.from(text.matchAll(/^\s*((?:on|send)[^\s:]+): /gmu), (match) => match[1]);

   // Order of the code units: `L` < `l`, `2` < `X` < `_`, and `ö` after all ASCII letters.
   const rendererToMain = ["ALpha", "Alpha", "Alzz", "Item", "Item2", "ItemX", "Item_x", "Zöld"];
   const mainToRenderer = ["BRavo", "Bravo"];
   const expected = {
      "window.d.ts": [
         ...mainToRenderer.map((name) => `on${name}`),
         ...rendererToMain.map((name) => `send${name}`),
      ],
      "preload.ts": [
         ...mainToRenderer.map((name) => `on${name}`),
         ...rendererToMain.map((name) => `send${name}`),
      ],
      "main.ts": [
         ...rendererToMain.map((name) => `on${name}`),
         ...mainToRenderer.map((name) => `send${name}`),
      ],
   };

   it.each(["sv", "en", "de-u-co-phonebk", "reversed en"])(
      "orders the members the same when the locale compares as %s",
      async (locale) => {
         const reversed = locale.startsWith("reversed");
         const collator = new Intl.Collator(reversed ? "en" : locale);
         const spy = vi.spyOn(String.prototype, "localeCompare").mockImplementation(function (
            this: string,
            that: string,
         ) {
            const result = collator.compare(this, that);
            return reversed ? -result : result;
         });
         try {
            project = await runFixture("sort-order");
         } finally {
            spy.mockRestore();
         }
         for (const [file, names] of Object.entries(expected)) {
            expect(members(project.generated[file as keyof typeof expected])).toStrictEqual(names);
         }
      },
   );

   it("generates files that type-check", async () => {
      project = await runFixture("sort-order");
      expect(await project.typecheck()).toBe("");
   });
});
