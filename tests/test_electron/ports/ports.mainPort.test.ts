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

// `mainPort` channels with real MessagePorts (see ports.port.test.ts).

import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { logPage } from "@testutils/electron/port-pages.js";
import { describe, expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   mainPortDestroyedBeforeConnect: async (ctx) => {
      ctx.serve("app://main/log.html", ctx.data.logPage);
      const gone = await ctx.open({ url: "app://main/log.html" });
      const live = await ctx.open({ url: "app://main/log.html" });
      gone.destroy();
      let error = "";
      try {
         ctx.ipc.logTail.connect(gone);
      } catch (caught: any) {
         error = `${caught.name}: ${caught.message}`;
      }
      const connection = ctx.ipc.logTail.connect(live);
      await ctx.until(live, () => (window as any).events.some((e: string[]) => e[0] === "ready"));
      connection.send("hello");
      const events = await ctx.until(
         live,
         () =>
            (window as any).events.some((e: string[]) => e[0] === "message") &&
            (window as any).events,
      );
      return { error, events };
   },

   mainPortRoundTrip: async (ctx) => {
      ctx.serve("app://main/log.html", ctx.data.logPage);
      const win = await ctx.open({ url: "app://main/log.html" });
      const connection = ctx.ipc.logTail.connect(win);
      const heard: unknown[][] = [];
      let ready = 0;
      connection.on((...args: unknown[]) => heard.push(args));
      connection.onReady(() => ready++);
      await ctx.until(win, () => (window as any).events.some((e: string[]) => e[0] === "ready"));
      connection.send("from main", 1);
      connection.send("without level");
      await ctx.evaluate(win, () => {
         ipc.logTail.send("from page", 2);
         ipc.logTail.send("only line");
      });
      await ctx.waitFor(() => heard.length === 2);
      const events = await ctx.until(
         win,
         () =>
            (window as any).events.filter((e: string[]) => e[0] === "message").length >= 2 &&
            (window as any).events,
      );
      connection.close();
      await ctx.until(win, () => (window as any).events.some((e: string[]) => e[0] === "close"));
      return { heard, ready, events };
   },

   mainPortConnectBeforeLoad: async (ctx) => {
      ctx.serve("app://main/log.html", ctx.data.logPage);
      const win = ctx.blank();
      const connection = ctx.ipc.logTail.connect(win);
      connection.send("queued");
      await win.loadURL("app://main/log.html");
      await ctx.until(win, () => (window as any).events.length >= 2);
      return { events: await ctx.evaluate(win, () => (window as any).events) };
   },

   mainPortReload: async (ctx) => {
      ctx.serve("app://main/log.html", ctx.data.logPage);
      const win = await ctx.open({ url: "app://main/log.html" });
      const connection = ctx.ipc.logTail.connect(win);
      let ready = 0;
      connection.onReady(() => ready++);
      await ctx.waitFor(() => ready === 1);
      win.webContents.reload();
      await ctx.waitFor(() => ready === 2, "the page after the reload");
      connection.send("after the reload");
      await ctx.until(win, () => (window as any).events.some((e: string[]) => e[0] === "message"));
      return { ready, events: await ctx.evaluate(win, () => (window as any).events) };
   },

   mainPortBounded: async (ctx) => {
      ctx.serve(
         "app://main/bounded.html",
         `<!doctype html><title>b</title><script>
            window.events = [];
            ipc.bounded.on((n) => events.push(n));
         </script>`,
      );
      const warnings: string[] = [];
      console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
      // The window has not loaded, so nothing is paired and the messages wait in the queue.
      const win = ctx.blank();
      const connection = ctx.ipc.bounded.connect(win);
      for (let n = 1; n <= 5; n++) {
         connection.send(n);
      }
      await win.loadURL("app://main/bounded.html");
      await ctx.until(win, () => (window as any).events.length >= 3);
      return { events: await ctx.evaluate(win, () => (window as any).events), warnings };
   },

   // The scenarios below read the state after a pause.

   // A main-frame load fails, and Electron shows its error page, with a did-finish-load of its own.
   mainPortFailedLoad: async (ctx) => {
      ctx.serve("app://main/log.html", ctx.data.logPage);
      const win = ctx.blank();
      const connection = ctx.ipc.logTail.connect(win);
      const main: string[] = [];
      connection.onReady(() => main.push("ready"));
      connection.onClose(() => main.push("close"));
      connection.send("queued");
      // Port 1 is one that Chromium refuses to load, so the load fails without a network.
      const failure = await win.loadURL("http://127.0.0.1:1/").then(
         () => "loaded",
         (error: any) => error.code,
      );
      await ctx.sleep(500);
      const afterFailure = [...main];
      await win.loadURL("app://main/log.html");
      await ctx.until(win, () => (window as any).events.length >= 2);
      return { failure, afterFailure, page: await ctx.evaluate(win, () => (window as any).events) };
   },

   // The load of a page is stopped after the navigation committed, such as by webContents.stop()
   // while the document is still arriving. Electron fires did-fail-load with ERR_ABORTED and
   // did-stop-loading, and no did-finish-load, but the document and its preload script are there.
   mainPortStoppedAfterCommit: async (ctx) => {
      const http = require("node:http");
      const server = http.createServer((_request: any, response: any) => {
         response.writeHead(200, { "content-type": "text/html" });
         response.write(ctx.data.logPage);
         setTimeout(() => response.end("<p>the rest</p>"), 1500).unref();
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
         const win = ctx.blank();
         const connection = ctx.ipc.logTail.connect(win);
         const main: string[] = [];
         connection.onReady(() => main.push("ready"));
         connection.send("queued");
         win.webContents.once("did-navigate", () => setTimeout(() => win.webContents.stop(), 150));
         await win.loadURL(`http://127.0.0.1:${server.address().port}/`).catch(() => undefined);
         await ctx.until(win, () => (window as any).events.length >= 2);
         return { main: [...main], page: await ctx.evaluate(win, () => (window as any).events) };
      } finally {
         server.closeAllConnections();
         server.close();
      }
   },
};

describeElectron(
   "mainPort channels in Electron",
   "electron-ports",
   scenarios,
   (group) => {
      describe("mainPort", () => {
         it("sends a message each way between the main process and a page", () => {
            const result = group.value("mainPortRoundTrip");
            expect(result.ready).toBe(1);
            expect(result.heard).toStrictEqual([["from page", 2], ["only line"]]);
            expect(result.events).toStrictEqual([
               ["ready"],
               ["message", "from main", 1],
               ["message", "without level"],
            ]);
         });

         it("throws Electron's own error for a window that was destroyed, and connects the others", () => {
            const { error, events } = group.value("mainPortDestroyedBeforeConnect");
            expect(error).toBe("TypeError: Object has been destroyed");
            expect(events).toStrictEqual([["ready"], ["message", "hello"]]);
         });

         it("pairs a window which was connected before it loaded, and flushes the queue", () => {
            expect(group.value("mainPortConnectBeforeLoad").events).toStrictEqual([
               ["ready"],
               ["message", "queued"],
            ]);
         });

         it("is ready again, and delivers, after the page was reloaded", () => {
            const { ready, events } = group.value("mainPortReload");
            expect(ready).toBe(2);
            // The events are those of the page after the reload.
            expect(events).toStrictEqual([["ready"], ["message", "after the reload"]]);
         });

         it("warns once when the queue of a connection which is not paired overflows", () => {
            const { warnings } = group.value("mainPortBounded");
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toContain("bounded");
            expect(warnings[0]).toContain("maxQueue 3");
         });

         it("flushes the newest messages of a full queue once the window is paired", () => {
            expect(group.value("mainPortBounded").events).toStrictEqual([3, 4, 5]);
         });

         it("does not pair the error page of a failed load, and keeps the queue for the next page", () => {
            expect(group.value("mainPortFailedLoad")).toStrictEqual({
               failure: "ERR_UNSAFE_PORT",
               afterFailure: [],
               page: [["ready"], ["message", "queued"]],
            });
         });
      });

      it("pairs the document of a load that was stopped after its navigation committed", () => {
         expect(group.value("mainPortStoppedAfterCommit")).toStrictEqual({
            main: ["ready"],
            page: [["ready"], ["message", "queued"]],
         });
      });
   },
   { logPage },
);
