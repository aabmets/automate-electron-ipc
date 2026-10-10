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

// How the ports of a page survive navigations that do not commit, and many connections, in a real
// Electron process (see ports.port.test.ts).

import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { chatPage, logPage } from "@testutils/electron/port-pages.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   // A navigation which never commits, such as one that will-navigate prevents (Electron security
   // checklist #13), leaves the page as it was, with its ports.
   abortedNavigation: async (ctx) => {
      ctx.serve("app://main/chat.html", ctx.data.chatPage);
      ctx.serve("app://main/log.html", ctx.data.logPage);
      const chatA = await ctx.open({ url: "app://main/chat.html" });
      const chatB = await ctx.open({ url: "app://main/chat.html" });
      const log = await ctx.open({ url: "app://main/log.html" });
      ctx.ipc.chat.connect(chatA, chatB);
      const connection = ctx.ipc.logTail.connect(log);
      const main: string[] = [];
      connection.onReady(() => main.push("ready"));
      connection.onClose(() => main.push("close"));
      for (const win of [chatA, chatB, log]) {
         await ctx.until(win, () => (window as any).events.length === 1);
         win.webContents.on("will-navigate", (event: any) => event.preventDefault());
      }
      for (const win of [chatA, log]) {
         await ctx.evaluate(win, () => {
            (window as any).marker = "same document";
            location.href = "app://main/elsewhere.html";
         });
      }
      await ctx.sleep(1000);
      const page = (win: unknown) =>
         ctx.evaluate(win, () => ({
            marker: (window as any).marker,
            events: (window as any).events,
         }));
      const pages = { log: await page(log), chatA: await page(chatA), chatB: await page(chatB) };
      // A copy: the scenario is over when the result is read, and the connection closes with its window.
      return { main: [...main], ...pages };
   },

   // Eleven connections of one window, such as one per channel, are normal use.
   manyConnections: async (ctx) => {
      ctx.serve("app://main/log.html", ctx.data.logPage);
      const warnings: string[] = [];
      const onWarning = (warning: Error) => warnings.push(`${warning.name}: ${warning.message}`);
      process.on("warning", onWarning);
      try {
         const win = await ctx.open({ url: "app://main/log.html" });
         const connections = [];
         let ready = 0;
         for (let n = 0; n < 11; n++) {
            const connection = ctx.ipc.logTail.connect(win);
            connection.onReady(() => ready++);
            connections.push(connection);
         }
         await ctx.waitFor(() => ready === 11, "all the connections");
         for (const connection of connections) {
            connection.close();
         }
         return warnings;
      } finally {
         process.off("warning", onWarning);
      }
   },
};

describeElectron(
   "port channels and navigations in Electron",
   "electron-ports",
   scenarios,
   (group) => {
      it("leaves the ports of a page alone when a navigation of it does not commit", () => {
         expect(group.value("abortedNavigation")).toStrictEqual({
            main: ["ready"],
            log: { marker: "same document", events: [["ready"]] },
            chatA: { marker: "same document", events: [["ready"]] },
            chatB: { events: [["ready"]] },
         });
      });

      // Every connection used to add its own 'destroyed' listener and four load listeners.
      it("connects a window many times without a MaxListenersExceededWarning", () => {
         expect(group.value("manyConnections")).toStrictEqual([]);
      });
   },
   { chatPage, logPage },
);
