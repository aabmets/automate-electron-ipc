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

// How a page and a child are paired to one port, and when connect fails, in a real Electron process
// (see utilityPorts.calls.test.ts).

// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures

import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   reload: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.query.handle(async (sql: string) => [{ id: 1, label: sql }]);
         ipc.count.handle(async function* (to: number) {
            for (let n = 1; n <= to; n++) {
               yield n;
            }
         });
      });
      const win = await ctx.open();
      ctx.ipc.query.connect(child, win);
      ctx.ipc.count.connect(child, win);
      const before = await ctx.evaluate(win, () => ipc.query.invoke("before"));

      win.webContents.reload();
      await ctx.waitFor(() => !win.webContents.isLoading(), "the page to reload");

      // The page of the reload waits for the port that the main process pairs again.
      const after = await ctx.evaluate(win, async () => {
         const chunks: number[] = [];
         for await (const n of ipc.count.stream(2)) {
            chunks.push(n);
         }
         return { rows: await ipc.query.invoke("after"), chunks };
      });
      return { before, after };
   },

   // A navigation which never commits, such as one that will-navigate prevents (Electron security
   // checklist #13), leaves the page and its port as they were.
   abortedNavigation: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.whoami.handle(async () => 7);
         ipc.hang.handle(() => new Promise(() => undefined));
      });
      const win = await ctx.open();
      ctx.ipc.whoami.connect(child, win);
      ctx.ipc.hang.connect(child, win);
      const before = await ctx.evaluate(win, () => ipc.whoami.invoke());
      await ctx.evaluate(win, () => {
         (window as any).marker = "same document";
         (window as any).hung = "pending";
         ipc.hang.invoke().catch((error: any) => {
            (window as any).hung = `${error.code}: ${error.message}`;
         });
      });
      win.webContents.on("will-navigate", (event: any) => event.preventDefault());
      await ctx.evaluate(win, () => {
         location.href = "app://main/elsewhere.html";
      });
      await ctx.sleep(1000);
      const page = await ctx.evaluate(win, async () => ({
         marker: (window as any).marker,
         hung: (window as any).hung,
         after: await ipc.whoami.invoke(),
      }));
      return { before, ...page };
   },

   // The child exits before the main process connects a page to it. It was forked by
   // forkUtility, so the bindings saw the exit, and connect fails instead of leaving the page
   // waiting for a port which never comes.
   connectExitedChild: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.whoami.handle(async () => 7);
      });
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
      const win = await ctx.open();
      try {
         ctx.ipc.whoami.connect(child, win);
         return "connected";
      } catch (error: any) {
         return error.code;
      }
   },

   // A child that the bindings never saw cannot be connected: they could not tell that it exited.
   connectUnattachedChild: async (ctx) => {
      const child = await ctx.fork(
         () => {
            ipc.whoami.handle(async () => 7);
         },
         { bindings: false },
      );
      const win = await ctx.open();
      let unattached = "connected";
      try {
         ctx.ipc.whoami.connect(child, win);
      } catch (error: any) {
         unattached = error.code;
      }
      ctx.main.attachUtility(child);
      ctx.ipc.whoami.connect(child, win);
      const attached = await ctx.evaluate(win, () => ipc.whoami.invoke());
      return { unattached, attached };
   },

   twoPages: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.query.handle(async (sql: string) => [{ id: process.pid, label: sql }]);
      });
      const one = await ctx.open();
      const two = await ctx.open();
      const first = ctx.ipc.query.connect(child, one);
      ctx.ipc.query.connect(child, two);
      const both = [
         await ctx.evaluate(one, () => ipc.query.invoke("one")),
         await ctx.evaluate(two, () => ipc.query.invoke("two")),
      ];

      first.close();
      const closed = await ctx.evaluate(one, () =>
         ipc.query.invoke("closed").then(
            () => null,
            (error: any) => error.code,
         ),
      );
      const stillOpen = await ctx.evaluate(two, () => ipc.query.invoke("still"));
      return { both, closed, stillOpen };
   },
};

describeElectron(
   "pairing utility ports in Electron",
   "electron-utility-ports",
   scenarios,
   (group) => {
      it("leaves the port of a page alone when a navigation of it does not commit", () => {
         expect(group.value("abortedNavigation")).toStrictEqual({
            before: 7,
            marker: "same document",
            hung: "pending",
            after: 7,
         });
      });

      it("fails connect for a child that exited", () => {
         expect(group.value("connectExitedChild")).toBe("IPC_UTILITY_EXITED");
      });

      it("fails connect for a child that was never attached, and connects it once attached", () => {
         expect(group.value("connectUnattachedChild")).toStrictEqual({
            unattached: "IPC_UTILITY_NOT_ATTACHED",
            attached: 7,
         });
      });

      it("pairs again when the page reloads", () => {
         expect(group.value("reload")).toStrictEqual({
            before: [{ id: 1, label: "before" }],
            after: { rows: [{ id: 1, label: "after" }], chunks: [1, 2] },
         });
      });

      it("gives every page a port of its own, and closes one without the other", () => {
         const { both, closed, stillOpen } = group.value("twoPages");
         expect(both[0][0].label).toBe("one");
         expect(both[1][0].label).toBe("two");
         expect(closed).toBe("IPC_UTILITY_EXITED");
         expect(stillOpen[0].label).toBe("still");
      });
   },
);
