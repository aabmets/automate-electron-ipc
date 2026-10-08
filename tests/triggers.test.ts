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
import { BROWSER_WINDOW_EVENTS } from "@src/browser-window-events.js";
import parser from "@src/parser.js";
import vld from "@src/validators.js";
import { ChannelSpecGenerator } from "@testutils/validator-utils.js";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

function triggerSpec(trigger: string) {
   const spec = new ChannelSpecGenerator().generate("MainToRenderer", "Broadcast");
   return { ...spec, trigger };
}

describe("trigger validation", () => {
   it("accepts every documented BrowserWindow event", () => {
      for (const event of BROWSER_WINDOW_EVENTS) {
         expect(() => vld.validateChannelSpecs([triggerSpec(event)])).not.toThrowError();
      }
   });

   // Regression for B5: the `as` form and untyped schemas bypass the type-level check.
   it("rejects a trigger which is not a BrowserWindow event", () => {
      expect(() => vld.validateChannelSpecs([triggerSpec("not-an-event")])).toThrowError(
         /'not-an-event' is not a BrowserWindow event\. Use one of: show, ready-to-show/,
      );
   });

   it("rejects an unknown trigger in the as form of a schema file", () => {
      const parse = () =>
         parser.parseSpecs({
            contents: `
               import { defineChannels, emit } from "automate-electron-ipc";
               export default defineChannels({
                  progress: emit({ trigger: "focuss" }) as (n: number) => void,
               });
            `,
            relativePath: "",
            fullPath: "",
         });
      expect(parse).toThrowError("'focuss' is not a BrowserWindow event");
   });

   it("lists the same events as the public EmitConfig type", () => {
      const types = fs.readFileSync(path.join(root, "types/index.d.ts"), "utf8");
      const union = types.slice(
         types.indexOf("trigger?:"),
         types.indexOf("}", types.indexOf("trigger?:")),
      );
      const typed = Array.from(union.matchAll(/"([^"]+)"/g), (match) => match[1]);
      expect([...typed].sort()).toStrictEqual([...BROWSER_WINDOW_EVENTS].sort());
   });

   it("lists only events which the BrowserWindow class of Electron emits", () => {
      const electron = fs.readFileSync(
         path.join(root, "node_modules/electron/electron.d.ts"),
         "utf8",
      );
      const start = electron.indexOf("class BrowserWindow extends BaseWindow");
      const end = electron.indexOf("class BrowserWindowConstructor", start);
      const section = electron.slice(start, end === -1 ? undefined : end);
      for (const event of BROWSER_WINDOW_EVENTS) {
         expect(section, event).toContain(`on(event: '${event}'`);
      }
   });
});
