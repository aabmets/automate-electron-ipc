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

// Runs the generated `getPathForFile` helper in a real Electron process: a sandboxed,
// context-isolated page hands a `File` over contextBridge, and the real `webUtils` of the sandboxed
// preload script returns its path. The file of the page comes from a file input which the main
// process fills through the DevTools protocol, since a script cannot drop a file on the page.

import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
import { afterAll, beforeAll, expect, it } from "vitest";

declare const ipc: any;
declare const document: any;

const scenarios: Record<string, Scenario> = {
   pickedFile: async (ctx) => {
      const win = await ctx.open();
      await ctx.evaluate(win, () => {
         const input = document.createElement("input");
         input.type = "file";
         input.id = "picker";
         document.body.appendChild(input);
      });
      const dbg = win.webContents.debugger;
      dbg.attach("1.3");
      const { root } = await dbg.sendCommand("DOM.getDocument");
      const { nodeId } = await dbg.sendCommand("DOM.querySelector", {
         nodeId: root.nodeId,
         selector: "#picker",
      });
      await dbg.sendCommand("DOM.setFileInputFiles", { nodeId, files: [ctx.data.file] });
      return await ctx.evaluate(win, () => {
         const file = document.getElementById("picker").files[0];
         return { name: file.name, path: ipc.getPathForFile(file) };
      });
   },

   fileWithoutPath: async (ctx) => {
      const win = await ctx.open();
      return await ctx.evaluate(win, () => ipc.getPathForFile(new File(["x"], "memory.txt")));
   },

   notAFile: async (ctx) => {
      const win = await ctx.open();
      return await ctx.evaluate(win, () => {
         try {
            ipc.getPathForFile("not a file");
            return { threw: false };
         } catch (error: any) {
            return { threw: true, message: String(error?.message ?? error) };
         }
      });
   },

   members: async (ctx) => {
      const win = await ctx.open();
      return await ctx.evaluate(win, () => ({
         members: Object.keys(ipc).sort(),
         type: typeof ipc.getPathForFile,
      }));
   },
};

let dir: string;
let file: string;

beforeAll(async () => {
   dir = await fsp.mkdtemp(path.join(tmpdir(), "vitest-path-for-file-"));
   file = path.join(dir, "dropped.txt");
   await fsp.writeFile(file, "hello");
});

afterAll(async () => {
   await fsp.rm(dir, { recursive: true, force: true });
});

describeElectron(
   "getPathForFile in a sandboxed window",
   "path-for-file",
   scenarios,
   (group) => {
      it("exposes the helper next to the channels", () => {
         expect(group.value("members")).toStrictEqual({
            members: ["getPathForFile", "upload"],
            type: "function",
         });
      });

      it("returns the path of a file that the user picked", async () => {
         const picked = group.value("pickedFile");
         expect(picked.name).toBe("dropped.txt");
         expect(await fsp.realpath(picked.path)).toBe(await fsp.realpath(file));
      });

      it("returns an empty string for a file that is not on the disk", () => {
         expect(group.value("fileWithoutPath")).toBe("");
      });

      it("throws for a value that is not a File", () => {
         expect(group.value("notAFile").threw).toBe(true);
      });
   },
   // The path is known only when the tests run, so it goes in as a getter.
   {
      get file() {
         return file;
      },
   },
);
