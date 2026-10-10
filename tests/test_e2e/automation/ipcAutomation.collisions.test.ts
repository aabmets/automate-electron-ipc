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

import { methodLine } from "@testutils/e2e/generated-text-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { describe, expect, it } from "vitest";

describe("ipcAutomation, type names that collide across schema files", () => {
   // Imports were deduped by local name only, so two `User` types were
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
   it("imports types of the same name that are declared in two schema files under distinct names", async () => {
      const project = await fixtures.run("name-collisions");
      const { generated } = project;

      for (const file of ["main.ts", "types.ts"] as const) {
         const userB = importedAs(generated[file], "User", "./schema/b");
         const userC = importedAs(generated[file], "User", "./schema/c");
         expect(userB).not.toBe(userC);

         const method = file === "main.ts" ? "handle" : "invoke";
         expect(methodLine(generated[file], "getUserB", method)).toContain(`Promise<${userB}>`);
         expect(methodLine(generated[file], "getUserC", method)).toContain(`Promise<${userC}>`);
      }
   });

   it("keeps an imported type and a declared type of the same name apart", async () => {
      const project = await fixtures.run("name-collisions");
      const { generated } = project;

      for (const file of ["main.ts", "types.ts"] as const) {
         const imported = importedAs(generated[file], "User", "./types/user");
         const declared = importedAs(generated[file], "User", "./schema/b");
         expect(imported).not.toBe(declared);

         const method = file === "main.ts" ? "handle" : "invoke";
         expect(methodLine(generated[file], "getUserA", method)).toContain(`Promise<${imported}>`);
         expect(methodLine(generated[file], "getUserB", method)).toContain(`Promise<${declared}>`);
      }
      // Three declarations are called User: they get User, User_2 and User_3.
      const names = new Set(
         ["./types/user", "./schema/b", "./schema/c"].map((from) =>
            importedAs(generated["types.ts"], "User", from),
         ),
      );
      expect(names).toStrictEqual(new Set(["User", "User_2", "User_3"]));
   });

   it("imports namespaces of the same alias from different modules under distinct aliases", async () => {
      const project = await fixtures.run("name-collisions");
      const { generated } = project;

      for (const file of ["main.ts", "types.ts"] as const) {
         const text = generated[file];
         const aliasOf = (from: string) =>
            new RegExp(`^import type \\* as (\\w+) from "${from}";$`, "m").exec(text)?.[1];
         const one = aliasOf("./types/one");
         const two = aliasOf("./types/two");
         expect(one).toMatch(/^[A-Za-z_$][\w$]*$/);
         expect(two).toMatch(/^[A-Za-z_$][\w$]*$/);
         expect(one).not.toBe(two);

         const method = file === "main.ts" ? "handle" : "invoke";
         expect(methodLine(text, "getItemA", method)).toContain(`Promise<${one}.Item>`);
         expect(methodLine(text, "getItemB", method)).toContain(`Promise<${two}.Item>`);
      }
   });

   it("injects the event and repeats type params after a renamed type param bound", async () => {
      // Renaming `User` to `User_3` lengthened the
      // text before the parameter list, so `paramsStart` pointed into the wrong place.
      const project = await fixtures.run("name-collisions");
      const main = project.generated["main.ts"];
      const userC = importedAs(main, "User", "./schema/c");
      expect(userC).not.toBe("User");

      expect(methodLine(main, "findUserC", "handle")).toContain(
         `(callback: <T extends ${userC}>(event: IpcMainInvokeEvent, user: T) => Promise<T>, options?: IpcListenOptions)`,
      );
      expect(main).toContain(`<T extends ${userC}>(event: IpcMainInvokeEvent, user: T) => {`);
      expect(main).toContain("return callback(event, user);");
      expect(methodLine(main, "pushUserC", "send")).toContain(
         `<T extends ${userC}>(target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, user: T)`,
      );
   });

   // A type inside `${...}` kept its old name, and a member name was renamed.
   it("renames types inside template literal types, but not member names", async () => {
      const project = await fixtures.run("name-collisions");
      const main = project.generated["main.ts"];
      const userC = importedAs(main, "User", "./schema/c");
      expect(userC).not.toBe("User");

      expect(methodLine(main, "tagUserC", "handle")).toContain(
         `(callback: (event: IpcMainInvokeEvent, tag: \`user-\${${userC}["email"]}\`, ` +
            `shape: { User: ${userC} }) => Promise<${userC}["email"]>, options?: IpcListenOptions)`,
      );
      expect(methodLine(project.generated["types.ts"], "tagUserC", "invoke")).toContain(
         `(tag: \`user-\${${userC}["email"]}\`, shape: { User: ${userC} }) => `,
      );
   });

   it("accepts a Promise< void > return type for a send channel", async () => {
      const project = await fixtures.run("name-collisions");
      expect(methodLine(project.generated["main.ts"], "notifyC", "on")).toContain(
         "Promise< void >",
      );
   });

   it("imports a type that two schema files import once", async () => {
      const project = await fixtures.run("name-collisions");
      for (const file of ["main.ts", "types.ts"] as const) {
         const imports = project.generated[file].match(
            /^import type (?!.*\bChannel(?:Map|Def)\b).*"\.\/types\/shared";$/gm,
         );
         expect(imports).toStrictEqual(['import type { Shared } from "./types/shared";']);
      }
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("name-collisions");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, schema types named like generated names", () => {
   // A schema type called `BrowserWindow`, `Window` or `IpcMainEvent` was
   // imported under that name and clashed with the declaration of the generated file (TS2300).
   const importLine = (text: string, exported: string, from: string): string | undefined =>
      new RegExp(`^import type \\{ ${exported}(?: as \\w+)? \\} from "${from}";$`, "m").exec(
         text,
      )?.[0];

   it("imports the schema types under aliases in main.ts", async () => {
      const project = await fixtures.run("reserved-names");
      const main = project.generated["main.ts"];

      expect(main).toContain(
         'import type { IpcMainInvokeEvent, IpcMainEvent, BrowserWindow, WebContents, WebContentsView, WebFrameMain, IpcMain } from "electron";',
      );
      // The helpers and imports of the senders are reserved too.
      expect(importLine(main, "WebContents", "./schema")).toBe(
         'import type { WebContents as WebContents_2 } from "./schema";',
      );
      expect(importLine(main, "broadcastMessage", "./schema")).toBe(
         'import type { broadcastMessage as broadcastMessage_2 } from "./schema";',
      );
      expect(importLine(main, "resolveSendTarget", "./schema")).toBe(
         'import type { resolveSendTarget as resolveSendTarget_2 } from "./schema";',
      );
      expect(importLine(main, "sendToSenderFrame", "./schema")).toBe(
         'import type { sendToSenderFrame as sendToSenderFrame_2 } from "./schema";',
      );
      // The ask channels declare their own error, options and helpers, and use `Awaited`.
      for (const name of ["IpcAskError", "IpcAskOptions", "askRenderer", "PendingAsk", "Awaited"]) {
         expect(importLine(main, name, "./schema")).toBe(
            `import type { ${name} as ${name}_2 } from "./schema";`,
         );
      }
      expect(main).toContain(
         "_options: IpcAskOptions, options: IpcAskOptions_2): Promise<Awaited<IpcAskError_2>>",
      );
      expect(main).toContain("Promise<askRenderer_2>");
      expect(main).toContain("Promise<Awaited<Awaited_2>>");
      expect(main).toContain("export class IpcAskError extends Error");
      expect(importLine(main, "WebFrameMain", "./schema")).toBe(
         'import type { WebFrameMain as WebFrameMain_2 } from "./schema";',
      );
      expect(importLine(main, "BrowserWindow", "./schema")).toBe(
         'import type { BrowserWindow as BrowserWindow_2 } from "./schema";',
      );
      // `Window` is not declared by main.ts, nor by window.d.ts, so it keeps its name.
      expect(importLine(main, "Window", "./schema")).toBe(
         'import type { Window } from "./schema";',
      );
      expect(importLine(main, "ipc", "./schema")).toBe(
         'import type { ipc as ipc_2 } from "./schema";',
      );
      expect(importLine(main, "IpcApi", "./schema")).toBe(
         'import type { IpcApi } from "./schema";',
      );
      // The registry of the handlers is declared by main.ts, so the type takes an alias.
      expect(importLine(main, "registeredHandlers", "./schema")).toBe(
         'import type { registeredHandlers as registeredHandlers_2 } from "./schema";',
      );
      expect(main).toContain("Promise<registeredHandlers_2>");
      expect(importLine(main, "IpcMainEvent", "./types/events")).toBe(
         'import type { IpcMainEvent as IpcMainEvent_2 } from "./types/events";',
      );
      // The schema type is used in the signatures, the Electron type in the generated wrapper.
      expect(main).toContain(
         "(callback: (event: IpcMainEvent, options: BrowserWindow_2) => void, _options?: IpcListenOptions)",
      );
      expect(main).toContain(
         "(target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, event: IpcMainEvent_2)",
      );
      expect(main).toContain(
         "handle: (callback: (event: IpcMainInvokeEvent) => Promise<ipc_2>, options?: IpcListenOptions)",
      );
   });

   it("imports the schema types that are named like the helpers of scoped registration under aliases", async () => {
      const project = await fixtures.run("reserved-names");
      const main = project.generated["main.ts"];

      for (const name of [
         "IpcListenOptions",
         "IpcTarget",
         "IpcMain",
         "IpcContentsRecord",
         "contentsIpcRegistry",
         "resolveIpcTarget",
      ]) {
         expect(importLine(main, name, "./schema")).toBe(
            `import type { ${name} as ${name}_2 } from "./schema";`,
         );
      }
      expect(main).toContain("export interface IpcListenOptions {");
      expect(main).toContain("Promise<IpcListenOptions_2>");
      expect(main).toContain("Promise<IpcMain_2>");
   });

   it("imports the schema types under aliases in window.d.ts", async () => {
      const project = await fixtures.run("reserved-names");
      const types = project.generated["types.ts"];

      expect(importLine(types, "IpcApi", "./schema")).toBe(
         'import type { IpcApi as IpcApi_2 } from "./schema";',
      );
      expect(types).toContain("Promise<IpcApi_2>");
      expect(types).toContain("interface IpcApi {");
      // Only `Awaited` is a global that window.d.ts uses, so the other names keep theirs.
      expect(importLine(types, "Awaited", "./schema")).toBe(
         'import type { Awaited as Awaited_2 } from "./schema";',
      );
      expect(importLine(types, "IpcAskError", "./schema")).toBe(
         'import type { IpcAskError } from "./schema";',
      );
      expect(types).toContain(
         "handle: (callback: (pending: PendingAsk) => Awaited_2) => () => void;",
      );
      expect(importLine(types, "Window", "./schema")).toBe(
         'import type { Window } from "./schema";',
      );
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("reserved-names");
      expect(await project.typecheck()).toBe("");
   });
});
