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
import { methodLine } from "@testutils/e2e/generated-text-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { describe, expect, it, vi } from "vitest";

describe("ipcAutomation, handler and sender types", () => {
   // Regression for B6 and B7: `handle` listeners got the wrong event type, and Broadcast
   // senders were typed as promises although `ipcRenderer.send` returns `undefined`.
   it("types Unicast handlers with IpcMainInvokeEvent and Broadcast ones with IpcMainEvent", async () => {
      const project = await fixtures.run("handler-types");
      const main = project.generated["main.ts"];

      expect(main).toContain(
         'import type { IpcMainInvokeEvent, IpcMainEvent, IpcMain, WebContents } from "electron";',
      );
      expect(main).toContain("handle: (callback: (event: IpcMainInvokeEvent, id: number)");
      expect(main).toContain("(event: IpcMainInvokeEvent, id: number) => {");
      expect(main).toContain("return callback(event, id);");
      expect(main).toContain("on: (callback: (event: IpcMainEvent, text: string,");
      expect(main).toContain("(event: IpcMainEvent, text: string, ...rest: number[]) => {");
      expect(main).toContain("return callback(event, text, ...rest);");
      // No loosely typed parameter, as a whole word.
      expect(main).not.toMatch(/\bany\b/);
   });

   it("types Broadcast senders as void and Unicast senders as promises", async () => {
      const project = await fixtures.run("handler-types");
      const windowTypes = project.generated["window.d.ts"];

      expect(methodLine(windowTypes, "echo", "send")).toContain(
         "send: (text: string, ...rest: number[]) => void;",
      );
      expect(methodLine(windowTypes, "ping", "send")).toContain("send: (text: string) => void;");
      expect(methodLine(windowTypes, "getUser", "invoke")).toContain(
         "invoke: (id: number) => Promise<string>;",
      );
   });

   it("generates files that type-check against the declared signatures", async () => {
      const project = await fixtures.run("handler-types");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, rest, optional and destructured parameters", () => {
   // Regression for B4: the sender dropped the spread, so `webContents.send` received one array.
   it("forwards rest parameters with their spread", async () => {
      const project = await fixtures.run("param-shapes");
      const main = project.generated["main.ts"];

      expect(main).toContain(
         "(target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, label: string, ...values: number[])",
      );
      expect(main).toContain("resolveSendTarget(target).send('autoipc:restSum', label, ...values)");
      expect(main).toContain("broadcastMessage('autoipc:restSum', [label, ...values])");
      expect(main).toContain("resolveSendTarget(target).send('autoipc:optionalFlag', label, flag)");
      expect(main).toContain(
         "(target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, arg0: Point, arg1: [number, number])",
      );
      expect(main).toContain("resolveSendTarget(target).send('autoipc:destructured', arg0, arg1)");
      expect(main).toContain("broadcastMessage('autoipc:destructured', [arg0, arg1])");
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("param-shapes");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, non-ASCII schema source", () => {
   // Regression for T66: swc spans are UTF-8 byte offsets, so non-ASCII text (and a BOM) in front
   // of a signature shifted every later slice and garbled the generated signatures.
   it("generates intact signatures from a schema with a BOM and non-ASCII text", async () => {
      const project = await fixtures.run("non-ascii");
      const { generated } = project;
      expect(await fsp.readFile(path.join(project.dir, "ipc/schema.ts"), "utf8")).toMatch(
         /^\uFEFF/,
      );

      expect(methodLine(generated["main.ts"], "getÜser", "handle")).toContain(
         '(callback: (event: IpcMainInvokeEvent, id: "ñ", size: Größe) => Promise<Üser>, options?: IpcListenOptions)',
      );
      expect(generated["main.ts"]).toContain(
         `const handler = <T extends "ü" = "ü">(event: IpcMainInvokeEvent, arg: T) => {`,
      );
      expect(methodLine(generated["window.d.ts"], "getÜser", "invoke")).toContain(
         '(id: "ñ", size: Größe) => Promise<Üser>',
      );
      expect(methodLine(generated["window.d.ts"], "greet", "send")).toContain(
         '(message: "héllo 😀") => void',
      );
      expect(generated["window.d.ts"]).toContain('import type { Größe } from "./schema";');
      expect(generated["window.d.ts"]).toContain('import type { Üser } from "./schema";');
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("non-ascii");
      expect(await project.typecheck()).toBe("");
   });
});

describe("ipcAutomation, locale-independent output order", () => {
   // Regression for T67: members were ordered with `localeCompare`, which depends on the locale
   // of the process and compared the whole callable, so `sendItem` and `sendItem2` swapped places.
   const members = (text: string): string[] =>
      Array.from(
         text.matchAll(/^ {3}([\p{L}\p{N}_$]+): (?=\{$|getPortObject)/gmu),
         (match) => match[1],
      );

   // Order of the code units: `L` < `l`, `2` < `X` < `_`, and `ö` after all ASCII letters.
   const names = [
      "aLpha",
      "alpha",
      "alzz",
      "bRavo",
      "bravo",
      "item",
      "item2",
      "itemX",
      "item_x",
      "zöld",
   ];
   const expected = {
      "window.d.ts": names,
      "preload.ts": names,
      "main.ts": names,
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
         const project = await fixtures.run("sort-order").finally(() => spy.mockRestore());
         for (const [file, names] of Object.entries(expected)) {
            expect(members(project.generated[file as keyof typeof expected])).toStrictEqual(names);
         }
      },
   );

   it("generates files that type-check", async () => {
      const project = await fixtures.run("sort-order");
      expect(await project.typecheck()).toBe("");
   });
});

// T72: channel names are free of the rules that came from the old listener names.
describe("ipcAutomation, channel names", () => {
   it("accepts short, 'on'-prefixed, capitalized and symbol-led channel names", async () => {
      const project = await fixtures.run("short-names");
      const { "main.ts": main, "preload.ts": preload, "window.d.ts": dts } = project.generated;

      for (const name of ["ok", "on", "onReady", "Capital", "_hidden", "$dollar", "p"]) {
         const member = new RegExp(`^ {3}${name.replace("$", "\\$")}: `, "m");
         expect(main).toMatch(member);
         expect(preload).toMatch(member);
         expect(dts).toMatch(member);
      }
      expect(main).toContain("'autoipc:ok'");
      expect(main).toContain("'autoipc:onReady'");
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run("short-names");
      expect(await project.typecheck()).toBe("");
   });
});
