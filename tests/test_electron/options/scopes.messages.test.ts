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

// Sends, streams and the registration of windows in scopes, in a real Electron process (see
// scopes.invoke.test.ts).

import { runFixture } from "@testutils/e2e-utils.js";
import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { describe, expect, it } from "vitest";

declare const ipc: any;

const forbidden = { name: "IpcForbiddenError", code: "IPC_FORBIDDEN" };

const scenarios: Record<string, Scenario> = {
   sends: async (ctx) => {
      const settings = await ctx.open({ scope: "settings" });
      const editor = await ctx.open({ scope: "editor" });
      const unregistered = await ctx.open({ scope: "settings" });
      ctx.main.registerScope(settings, "settings");
      ctx.main.registerScope(editor, "editor");
      const received: string[] = [];
      const rejected: string[] = [];
      ctx.main.configureIpc({
         onRejected: (_event: unknown, channel: string) => rejected.push(channel),
      });
      ctx.ipc.audit.on((_event: unknown, text: string) => received.push(`audit ${text}`));
      ctx.ipc.note.on((_event: unknown, text: string) => received.push(`note ${text}`));
      await ctx.evaluate(settings, () => ipc.audit.send("from settings"));
      await ctx.evaluate(editor, () => ipc.audit.send("from editor"));
      await ctx.evaluate(unregistered, () => ipc.audit.send("from unregistered"));
      // A send without scopes shows that the dropped message had time to arrive.
      await ctx.evaluate(unregistered, () => ipc.note.send("from unregistered"));
      await ctx.waitFor(() => received.includes("note from unregistered"));
      await ctx.sleep(100);
      return { received: received.sort(), rejected };
   },

   streams: async (ctx) => {
      const editor = await ctx.open({ scope: "editor" });
      const unregistered = await ctx.open({ scope: "editor" });
      ctx.main.registerScope(editor, "editor");
      let started = 0;
      ctx.ipc.exportRows.handle(async function* () {
         started++;
         yield 1;
         yield 2;
      });
      const read = (win: unknown) =>
         ctx.evaluate(win, async () => {
            const chunks: number[] = [];
            try {
               for await (const chunk of ipc.exportRows.stream()) {
                  chunks.push(chunk);
               }
               return { chunks };
            } catch (cause: any) {
               return { chunks, name: cause.name, code: cause.code };
            }
         });
      return { editor: await read(editor), unregistered: await read(unregistered), started };
   },

   dispose: async (ctx) => {
      const win = await ctx.open({ scope: "settings" });
      const dispose = ctx.main.registerScope(win, "settings");
      ctx.ipc.getSettings.handle(async () => "settings");
      const call = () =>
         ctx.evaluate(win, async () => {
            try {
               return { value: await ipc.getSettings.invoke() };
            } catch (cause: any) {
               return { name: cause.name, code: cause.code };
            }
         });
      const before = await call();
      dispose();
      const after = await call();
      ctx.main.registerScope(win, "settings");
      const again = await call();
      return { before, after, again };
   },

   iframe: async (ctx) => {
      ctx.serve("app://main/index.html", '<iframe src="app://other/frame.html"></iframe>');
      ctx.serve("app://other/frame.html", "<p>frame</p>");
      const win = await ctx.open({ scope: "settings", subframes: true });
      ctx.main.registerScope(win, "settings");
      const frame = win.webContents.mainFrame.frames[0];
      ctx.ipc.getSettings.handle(async () => "settings");
      ctx.ipc.vault.handle(async () => "secret");
      const call = (target: unknown) =>
         ctx.evaluate(target, async () => {
            const outcome: Record<string, unknown> = { origin: location.origin };
            for (const name of ["getSettings", "vault"] as const) {
               try {
                  outcome[name] = await ipc[name].invoke();
               } catch (cause: any) {
                  outcome[name] = { name: cause.name, code: cause.code };
               }
            }
            return outcome;
         });
      return { main: await call(win), frame: await call(frame) };
   },
};

describeElectron(
   "scopes, send, stream and registration, in Electron",
   "electron-scopes",
   scenarios,
   (group) => {
      describe("send", () => {
         it("delivers a send of a window of the scopes of the channel, and drops the others", () => {
            const { received, rejected } = group.value("sends");
            expect(received).toStrictEqual([
               "audit from editor",
               "audit from settings",
               "note from unregistered",
            ]);
            expect(rejected).toStrictEqual(["audit"]);
         });
      });

      describe("stream", () => {
         it("streams to the window of the scope, and fails the stream of another", () => {
            const { editor, unregistered, started } = group.value("streams");
            expect(editor).toStrictEqual({ chunks: [1, 2] });
            expect(unregistered).toMatchObject({ chunks: [], ...forbidden });
            expect(started).toBe(1);
         });
      });

      describe("the registration", () => {
         it("ends when the function that registerScope returned is called, and can be made again", () => {
            expect(group.value("dispose")).toStrictEqual({
               before: { value: "settings" },
               after: forbidden,
               again: { value: "settings" },
            });
         });

         it("covers the frames of the window, whose origin is still checked by allowedOrigins", () => {
            expect(group.value("iframe")).toStrictEqual({
               main: { origin: "app://main", getSettings: "settings", vault: "secret" },
               frame: { origin: "app://other", getSettings: "settings", vault: forbidden },
            });
         });
      });

      it("type-checks the generated files of every scope", async () => {
         const project = await runFixture("electron-scopes");
         try {
            for (const scope of ["default", "settings", "editor"]) {
               expect(await project.typecheckScope(scope)).toBe("");
            }
         } finally {
            await project.cleanup();
         }
      }, 120_000);
   },
);
