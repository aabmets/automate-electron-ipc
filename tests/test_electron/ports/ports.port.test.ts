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

// `port` channels with real MessagePorts: they are transferred by the real `MessageChannelMain`,
// and received by the preload script of a sandboxed page.
//
// The scenarios run in Electron and cannot see this file, so the pages are passed as `data`.

import { runFixture } from "@testutils/e2e-utils.js";
import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { chatPage } from "@testutils/electron/port-pages.js";
import { describe, expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   chatRoundTrip: async (ctx) => {
      ctx.serve("app://main/chat.html", ctx.data.chatPage);
      const a = await ctx.open({ url: "app://main/chat.html" });
      const b = await ctx.open({ url: "app://main/chat.html" });
      ctx.ipc.chat.connect(a, b);
      const ready = (win: unknown) =>
         ctx.until(win, () => (window as any).events.some((e: string[]) => e[0] === "ready"));
      await ready(a);
      await ready(b);
      await ctx.evaluate(a, () => ipc.chat.send("hello from a"));
      await ctx.evaluate(b, () => ipc.chat.send("hello from b"));
      const events = (win: unknown) =>
         ctx.until(win, () => (window as any).events.length >= 2 && (window as any).events);
      return { a: await events(a), b: await events(b) };
   },

   chatCloseFromMain: async (ctx) => {
      ctx.serve("app://main/chat.html", ctx.data.chatPage);
      const a = await ctx.open({ url: "app://main/chat.html" });
      const b = await ctx.open({ url: "app://main/chat.html" });
      const connection = ctx.ipc.chat.connect(a, b);
      const ready = (win: unknown) =>
         ctx.until(win, () => (window as any).events.some((e: string[]) => e[0] === "ready"));
      await ready(a);
      await ready(b);
      connection.close();
      const closed = (win: unknown) =>
         ctx.until(win, () => (window as any).events.some((e: string[]) => e[0] === "close"));
      await closed(a);
      await closed(b);
      // A closed connection can be closed again, and the pages can still send without an error.
      connection.close();
      const sendAfter = await ctx.evaluate(a, () => {
         try {
            ipc.chat.send("into the void");
            return "no error";
         } catch (error: any) {
            return error.message;
         }
      });
      await ctx.sleep(150);
      return { sendAfter, b: await ctx.evaluate(b, () => (window as any).events) };
   },

   chatCloseFromPage: async (ctx) => {
      ctx.serve("app://main/chat.html", ctx.data.chatPage);
      const a = await ctx.open({ url: "app://main/chat.html" });
      const b = await ctx.open({ url: "app://main/chat.html" });
      await ctx.evaluate(a, () => {
         (window as any).peers = [];
         ipc.chat.onConnection((peer: unknown) => (window as any).peers.push(peer));
      });
      ctx.ipc.chat.connect(a, b);
      await ctx.until(a, () => (window as any).peers.length === 1);
      await ctx.until(b, () => (window as any).events.some((e: string[]) => e[0] === "ready"));
      await ctx.evaluate(a, () => (window as any).peers[0].close());
      await ctx.until(b, () => (window as any).events.some((e: string[]) => e[0] === "close"));
      return { peers: await ctx.evaluate(a, () => (window as any).peers.length) };
   },

   // The scenarios below find T76. They read the state after a pause and do not wait for it, so
   // that they return what happened, and do not fail with a timeout.

   chatConnectBeforeLoad: async (ctx) => {
      ctx.serve("app://main/chat.html", ctx.data.chatPage);
      const a = ctx.blank();
      const b = ctx.blank();
      ctx.ipc.chat.connect(a, b);
      await a.loadURL("app://main/chat.html");
      await b.loadURL("app://main/chat.html");
      await ctx.sleep(500);
      return {
         a: await ctx.evaluate(a, () => (window as any).events),
         b: await ctx.evaluate(b, () => (window as any).events),
      };
   },

   chatConnectRightAfterLoad: async (ctx) => {
      ctx.serve("app://main/chat.html", ctx.data.chatPage);
      const a = ctx.blank();
      const b = ctx.blank();
      await a.loadURL("app://main/chat.html");
      await b.loadURL("app://main/chat.html");
      ctx.ipc.chat.connect(a, b);
      await ctx.sleep(500);
      return {
         a: await ctx.evaluate(a, () => (window as any).events),
         b: await ctx.evaluate(b, () => (window as any).events),
      };
   },

   chatReload: async (ctx) => {
      ctx.serve("app://main/chat.html", ctx.data.chatPage);
      const a = await ctx.open({ url: "app://main/chat.html" });
      const b = await ctx.open({ url: "app://main/chat.html" });
      ctx.ipc.chat.connect(a, b);
      await ctx.until(a, () => (window as any).events.length === 1);
      await ctx.until(b, () => (window as any).events.length === 1);
      // The page of b is replaced, and the connection should pair it with a again.
      b.webContents.reload();
      await ctx.sleep(1000);
      await ctx.evaluate(a, () => ipc.chat.send("to the new page"));
      await ctx.evaluate(b, () => ipc.chat.send("from the new page"));
      await ctx.sleep(300);
      return {
         a: await ctx.evaluate(a, () => (window as any).events),
         b: await ctx.evaluate(b, () => (window as any).events),
      };
   },

   // A window that was destroyed before `connect` (T78): Electron's own error, and no leftovers.
   chatDestroyedBeforeConnect: async (ctx) => {
      ctx.serve("app://main/chat.html", ctx.data.chatPage);
      const a = await ctx.open({ url: "app://main/chat.html" });
      const gone = await ctx.open({ url: "app://main/chat.html" });
      const c = await ctx.open({ url: "app://main/chat.html" });
      gone.destroy();
      const errors: string[] = [];
      for (const [first, second] of [
         [a, gone],
         [gone, a],
         [gone, gone],
      ]) {
         try {
            ctx.ipc.chat.connect(first, second);
         } catch (error: any) {
            errors.push(`${error.name}: ${error.message}`);
         }
      }
      await ctx.sleep(300);
      const before = await ctx.evaluate(a, () => (window as any).events);
      // The live window still connects to another one, and is not told that anything closed.
      ctx.ipc.chat.connect(a, c);
      await ctx.until(a, () => (window as any).events.some((e: string[]) => e[0] === "ready"));
      await ctx.until(c, () => (window as any).events.some((e: string[]) => e[0] === "ready"));
      await ctx.evaluate(a, () => ipc.chat.send("still works"));
      const heard = await ctx.until(
         c,
         () =>
            (window as any).events.some((e: string[]) => e[0] === "message") &&
            (window as any).events,
      );
      return { errors, before, a: await ctx.evaluate(a, () => (window as any).events), c: heard };
   },
};

describeElectron(
   "port channels in Electron",
   "electron-ports",
   scenarios,
   (group) => {
      it("runs every scenario to completion, without uncaught errors in the main process", () => {
         const failed = Object.entries(group.run().results).filter(([, result]) => !result.ok);
         expect(failed).toStrictEqual([]);
         expect(group.run().uncaught).toStrictEqual([]);
      });

      describe("port", () => {
         it("connects two windows, so that a message goes each way", () => {
            expect(group.value("chatRoundTrip")).toStrictEqual({
               a: [["ready"], ["message", "hello from b"]],
               b: [["ready"], ["message", "hello from a"]],
            });
         });

         it("tells both pages when the main process closes the connection", () => {
            const { sendAfter, b } = group.value("chatCloseFromMain");
            expect(sendAfter).toBe("no error");
            expect(b).toStrictEqual([["ready"], ["close"]]);
         });

         it("tells the other page when a page closes its connection", () => {
            expect(group.value("chatCloseFromPage")).toStrictEqual({ peers: 1 });
         });

         // `isLoading()` is still true while `did-finish-load` fires, and after `loadURL` resolved,
         // so these three cover the moments at which a connection has to wait for the page.
         it("pairs windows which were connected before they loaded", () => {
            const { a, b } = group.value("chatConnectBeforeLoad");
            expect(a).toStrictEqual([["ready"]]);
            expect(b).toStrictEqual([["ready"]]);
         });

         it("pairs windows which are connected right after loadURL resolved", () => {
            const { a, b } = group.value("chatConnectRightAfterLoad");
            expect(a).toStrictEqual([["ready"]]);
            expect(b).toStrictEqual([["ready"]]);
         });

         it("throws Electron's own error for a window that was destroyed, and connects the others", () => {
            const { errors, before, a, c } = group.value("chatDestroyedBeforeConnect");
            expect(errors).toStrictEqual(new Array(3).fill("TypeError: Object has been destroyed"));
            expect(before).toStrictEqual([]);
            expect(a).toStrictEqual([["ready"]]);
            expect(c).toStrictEqual([["ready"], ["message", "still works"]]);
         });

         it("pairs a window again when its page was reloaded", () => {
            const { a, b } = group.value("chatReload");
            // The page of a hears its peer go away with the old document, and come back with the new one.
            expect(a).toStrictEqual([
               ["ready"],
               ["close"],
               ["ready"],
               ["message", "from the new page"],
            ]);
            expect(b).toStrictEqual([["ready"], ["message", "to the new page"]]);
         });
      });

      it("type-checks the generated files of the fixture", async () => {
         const project = await runFixture("electron-ports");
         try {
            expect(await project.typecheck()).toBe("");
         } finally {
            await project.cleanup();
         }
      }, 120_000);
   },
   { chatPage },
);
