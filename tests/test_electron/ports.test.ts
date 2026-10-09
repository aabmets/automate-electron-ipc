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

// `port` and `mainPort` channels with real MessagePorts: they are transferred by the real
// `MessageChannelMain`, and received by the preload script of a sandboxed page.

import { runFixture } from "@testutils/e2e-utils.js";
import { describeElectron, type ElectronGroup, type Scenario } from "@testutils/electron-utils.js";
import { describe, expect, it } from "vitest";

declare const ipc: any;

// The scenarios run in Electron and cannot see this file, so the pages are passed as `data`.

/** A page which records what happens on the `chat` channel, from the moment that it loads. */
const chatPage = `<!doctype html><title>chat</title><script>
   window.events = [];
   ipc.chat.on((...args) => events.push(["message", ...args]));
   ipc.chat.onReady(() => events.push(["ready"]));
   ipc.chat.onClose(() => events.push(["close"]));
</script>`;

/** A page which records what happens on the `logTail` channel, from the moment that it loads. */
const logPage = `<!doctype html><title>log</title><script>
   window.events = [];
   ipc.logTail.on((...args) => events.push(["message", ...args]));
   ipc.logTail.onReady(() => events.push(["ready"]));
   ipc.logTail.onClose(() => events.push(["close"]));
</script>`;

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
      await ctx.sleep(500);
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
      await ctx.sleep(1000);
      connection.send("after the reload");
      await ctx.sleep(300);
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
      await ctx.sleep(500);
      return { events: await ctx.evaluate(win, () => (window as any).events), warnings };
   },

   // The scenarios below find T85 (fixed) and T87. They read the state after a pause, as the ones above.

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
      await ctx.sleep(500);
      return { failure, afterFailure, page: await ctx.evaluate(win, () => (window as any).events) };
   },

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
         for (let n = 0; n < 11; n++) {
            connections.push(ctx.ipc.logTail.connect(win));
         }
         await ctx.sleep(300);
         for (const connection of connections) {
            connection.close();
         }
         return warnings;
      } finally {
         process.off("warning", onWarning);
      }
   },
};

describeElectron("port channels in Electron", "electron-ports", scenarios, body, {
   chatPage,
   logPage,
});

function body(group: ElectronGroup) {
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

   it("leaves the ports of a page alone when a navigation of it does not commit", () => {
      expect(group.value("abortedNavigation")).toStrictEqual({
         main: ["ready"],
         log: { marker: "same document", events: [["ready"]] },
         chatA: { marker: "same document", events: [["ready"]] },
         chatB: { events: [["ready"]] },
      });
   });

   // T87: every connection adds its own 'destroyed' listener and four load listeners to the contents.
   it.fails("connects a window many times without a MaxListenersExceededWarning", () => {
      expect(group.value("manyConnections")).toStrictEqual([]);
   });

   it("type-checks the generated files of the fixture", async () => {
      const project = await runFixture("electron-ports");
      try {
         expect(await project.typecheck()).toBe("");
      } finally {
         await project.cleanup();
      }
   }, 120_000);
}
