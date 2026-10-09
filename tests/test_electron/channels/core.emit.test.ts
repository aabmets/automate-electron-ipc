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

// Runs the generated emit bindings in a real Electron process (see core.invoke.test.ts).

import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { describe, expect, it } from "vitest";

declare const ipc: any;
declare const document: any;

const scenarios: Record<string, Scenario> = {
   // The reply of sendToSender reaches the frame that sent, here an iframe, and not its main frame.
   sendToSenderFrame: async (ctx) => {
      ctx.serve("app://main/index.html", '<iframe src="app://main/frame.html"></iframe>');
      ctx.serve("app://main/frame.html", "<p>frame</p>");
      const win = await ctx.open({ subframes: true });
      const frame = win.webContents.mainFrame.frames[0];
      const delivered = [];
      ctx.ipc.log.on((event: any, text: string) => {
         delivered.push(ctx.ipc.notice.sendToSender(event, `reply to ${text}`));
      });
      for (const target of [win, frame]) {
         await ctx.evaluate(target, () => {
            (window as any).notices = [];
            ipc.notice.on((text: string) => (window as any).notices.push(text));
         });
      }
      await ctx.evaluate(frame, () => ipc.log.send("the frame"));
      await ctx.until(frame, () => (window as any).notices.length === 1);
      await ctx.evaluate(win, () => ipc.log.send("the main frame"));
      await ctx.until(win, () => (window as any).notices.length === 1);
      await ctx.sleep(100);
      return {
         delivered,
         main: await ctx.evaluate(win, () => (window as any).notices),
         frame: await ctx.evaluate(frame, () => (window as any).notices),
      };
   },

   emitTargets: async (ctx) => {
      const { WebContentsView } = ctx.electron;
      const win = await ctx.open();
      const view = new WebContentsView({ webPreferences: ctx.webPreferences() });
      win.contentView.addChildView(view);
      await view.webContents.loadURL("app://main/view.html");
      const listen = (target: unknown) =>
         ctx.evaluate(target, () => {
            const received: unknown[][] = [];
            (window as any).received = received;
            // JSON has no undefined, so it is written out.
            ipc.notice.on((...args: unknown[]) =>
               received.push(args.map((arg) => (arg === undefined ? "undefined" : arg))),
            );
         });
      await listen(win);
      await listen(view);
      const frame = win.webContents.mainFrame;

      ctx.ipc.notice.send(win, "to window");
      ctx.ipc.notice.send(view, "to view", 1);
      ctx.ipc.notice.send(win.webContents, "to contents", 2);
      ctx.ipc.notice.send(frame, "to frame", 3);

      const read = (target: unknown) => ctx.evaluate(target, () => (window as any).received);
      await ctx.waitFor(
         async () => (await read(win)).length === 3 && (await read(view)).length === 1,
      );
      return { window: await read(win), view: await read(view) };
   },

   broadcast: async (ctx) => {
      const [a, b, c] = [await ctx.open(), await ctx.open(), await ctx.open()];
      const listen = (win: unknown) =>
         ctx.evaluate(win, () => {
            (window as any).ticks = [];
            ipc.tick.on((n: number) => (window as any).ticks.push(n));
         });
      await Promise.all([listen(a), listen(b), listen(c)]);
      const ticks = (win: unknown) => ctx.evaluate(win, () => (window as any).ticks);

      ctx.ipc.tick.broadcast(1);
      await ctx.waitFor(async () => (await ticks(c)).length === 1);
      const all = [await ticks(a), await ticks(b), await ticks(c)];

      ctx.ipc.tick.broadcastTo((contents: any) => contents.id === b.webContents.id, 2);
      await ctx.waitFor(async () => (await ticks(b)).length === 2);
      await ctx.sleep(100);
      const filtered = [await ticks(a), await ticks(b), await ticks(c)];

      // A window which was destroyed is not in the list of contents, and is not reached.
      c.destroy();
      let error: string | null = null;
      try {
         ctx.ipc.tick.broadcast(3);
         ctx.ipc.tick.broadcastTo(() => true, 4);
      } catch (cause: any) {
         error = String(cause?.message ?? cause);
      }
      await ctx.waitFor(async () => (await ticks(a)).length === 3 && (await ticks(b)).length === 4);
      await ctx.sleep(100);
      return { all, filtered, error, afterDestroy: [await ticks(a), await ticks(b)] };
   },

   bind: async (ctx) => {
      const win = await ctx.open();
      await ctx.evaluate(win, () => {
         (window as any).titles = [];
         ipc.titleChanged.on((title: string) => (window as any).titles.push(title));
      });
      const errors: string[] = [];
      let calls = 0;
      const dispose = ctx.ipc.titleChanged.bind(
         win,
         async () => {
            calls++;
            if (calls === 3) {
               throw new Error("provider failed");
            }
            return [`title ${win.webContents.getTitle()}`];
         },
         (error: Error) => errors.push(error.message),
      );
      const setTitle = (title: string) =>
         ctx.evaluate(win, (t: string) => (document.title = t), title);
      const titles = () => ctx.evaluate(win, () => (window as any).titles);
      await setTitle("one");
      await ctx.waitFor(async () => (await titles()).length === 1);
      await setTitle("two");
      await ctx.waitFor(async () => (await titles()).length === 2);
      await setTitle("three");
      await ctx.waitFor(() => errors.length === 1);
      dispose();
      await setTitle("four");
      await ctx.sleep(300);
      return { titles: await titles(), errors, calls };
   },
};

describeElectron("emit channels in Electron", "electron-core", scenarios, (group) => {
   describe("emit", () => {
      it("sends to a window, to a WebContentsView, to WebContents and to a frame", () => {
         const { window, view } = group.value("emitTargets");
         expect(window).toStrictEqual([
            ["to window", "undefined"],
            ["to contents", 2],
            ["to frame", 3],
         ]);
         expect(view).toStrictEqual([["to view", 1]]);
      });

      it("replies with sendToSender to the frame that sent, which may be an iframe", () => {
         expect(group.value("sendToSenderFrame")).toStrictEqual({
            delivered: [true, true],
            main: ["reply to the main frame"],
            frame: ["reply to the frame"],
         });
      });

      it("broadcasts to all windows, and filters with broadcastTo", () => {
         const result = group.value("broadcast");
         expect(result.all).toStrictEqual([[1], [1], [1]]);
         expect(result.filtered).toStrictEqual([[1], [1, 2], [1]]);
      });

      it("skips a window which was destroyed", () => {
         const result = group.value("broadcast");
         expect(result.error).toBeNull();
         expect(result.afterDestroy).toStrictEqual([
            [1, 3, 4],
            [1, 2, 3, 4],
         ]);
      });

      it("sends what the provider returns when the trigger fires, and reports a provider which fails", () => {
         const result = group.value("bind");
         expect(result.titles).toStrictEqual(["title one", "title two"]);
         expect(result.errors).toStrictEqual(["provider failed"]);
         // The dispose stops the binding, so the fourth title does not reach the provider.
         expect(result.calls).toBe(3);
      });
   });
});
