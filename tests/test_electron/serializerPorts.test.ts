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

// Runs the serializer of `port` and `mainPort` channels in a real Electron process: the messages
// cross real MessagePorts, transferred by the real `MessageChannelMain`, between sandboxed pages
// and the main process. The serializer module is bundled into the preload script by the runner.

import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

// The scenarios run in Electron and cannot see this file, so the pages are passed as `data`.

/** A page which records what arrives on the `tracker` channel, as what the page sees it is. */
const trackerPage = `<!doctype html><title>tracker</title><script>
   window.events = [];
   ipc.tracker.on((at, tags) => events.push({
      isDate: at instanceof Date,
      time: at.getTime(),
      isSet: tags instanceof Set,
      tags: [...tags],
   }));
   ipc.tracker.onReady(() => events.push("ready"));
</script>`;

/** A page which records what arrives on the `feed` channel, as what the page sees it is. */
const feedPage = `<!doctype html><title>feed</title><script>
   window.events = [];
   ipc.feed.on((at, counts) => events.push({
      isDate: at instanceof Date,
      time: at.getTime(),
      isMap: counts instanceof Map,
      counts: [...counts],
   }));
   ipc.feed.onReady(() => events.push("ready"));
</script>`;

const scenarios: Record<string, Scenario> = {
   trackerBetweenPages: async (ctx) => {
      ctx.serve("app://main/tracker.html", ctx.data.trackerPage);
      const a = await ctx.open({ url: "app://main/tracker.html" });
      const b = await ctx.open({ url: "app://main/tracker.html" });
      ctx.ipc.tracker.connect(a, b);
      const ready = (win: unknown) =>
         ctx.until(win, () => (window as any).events.includes("ready"));
      await ready(a);
      await ready(b);
      await ctx.evaluate(a, () => ipc.tracker.send(new Date(1000), new Set(["x", "y"])));
      await ctx.evaluate(b, () => ipc.tracker.send(new Date(2000), new Set()));
      const heard = (win: unknown) =>
         ctx.until(win, () => {
            const events = (window as any).events.filter((e: unknown) => e !== "ready");
            return events.length > 0 && events;
         });
      return { a: await heard(a), b: await heard(b) };
   },

   trackerQueuedBeforeReady: async (ctx) => {
      ctx.serve("app://main/tracker.html", ctx.data.trackerPage);
      const a = await ctx.open({ url: "app://main/tracker.html" });
      const b = await ctx.open({ url: "app://main/tracker.html" });
      // The channel queues the message while the pages have no port.
      await ctx.evaluate(a, () => ipc.tracker.send(new Date(3000), new Set(["queued"])));
      ctx.ipc.tracker.connect(a, b);
      return await ctx.until(b, () => {
         const events = (window as any).events.filter((e: unknown) => e !== "ready");
         return events.length > 0 && events;
      });
   },

   trackerUnserializable: async (ctx) => {
      ctx.serve("app://main/tracker.html", ctx.data.trackerPage);
      const a = await ctx.open({ url: "app://main/tracker.html" });
      const b = await ctx.open({ url: "app://main/tracker.html" });
      ctx.ipc.tracker.connect(a, b);
      await ctx.until(a, () => (window as any).events.includes("ready"));
      const thrown = await ctx.evaluate(a, () => {
         try {
            ipc.tracker.send(() => 1, new Set());
            return null;
         } catch (error: any) {
            return { name: error.name, code: error.code, message: error.message };
         }
      });
      await ctx.sleep(150);
      return { thrown, b: await ctx.evaluate(b, () => (window as any).events) };
   },

   feedMainToPage: async (ctx) => {
      ctx.serve("app://main/feed.html", ctx.data.feedPage);
      const win = await ctx.open({ url: "app://main/feed.html" });
      const connection = ctx.ipc.feed.connect(win);
      await ctx.until(win, () => (window as any).events.includes("ready"));
      connection.send(new Date(4000), new Map([["ada", 2]]));
      return await ctx.until(win, () => {
         const events = (window as any).events.filter((e: unknown) => e !== "ready");
         return events.length > 0 && events;
      });
   },

   feedPageToMain: async (ctx) => {
      ctx.serve("app://main/feed.html", ctx.data.feedPage);
      const win = await ctx.open({ url: "app://main/feed.html" });
      const connection = ctx.ipc.feed.connect(win);
      const heard: any[] = [];
      connection.on((at: Date, counts: Map<string, number>) => {
         heard.push({
            isDate: at instanceof Date,
            time: at.getTime(),
            isMap: counts instanceof Map,
            counts: [...counts],
         });
      });
      await ctx.until(win, () => (window as any).events.includes("ready"));
      await ctx.evaluate(win, () => ipc.feed.send(new Date(5000), new Map([["grace", 3]])));
      await ctx.waitFor(() => heard.length > 0, "the message arrives");
      return heard;
   },

   feedQueuedBeforeLoad: async (ctx) => {
      ctx.serve("app://main/feed.html", ctx.data.feedPage);
      const win = ctx.blank();
      const connection = ctx.ipc.feed.connect(win);
      connection.send(new Date(6000), new Map([["queued", 1]]));
      await win.loadURL("app://main/feed.html");
      return await ctx.until(win, () => {
         const events = (window as any).events.filter((e: unknown) => e !== "ready");
         return events.length > 0 && events;
      });
   },

   feedUnserializable: async (ctx) => {
      ctx.serve("app://main/feed.html", ctx.data.feedPage);
      const win = await ctx.open({ url: "app://main/feed.html" });
      const connection = ctx.ipc.feed.connect(win);
      await ctx.until(win, () => (window as any).events.includes("ready"));
      try {
         connection.send(() => 1, new Map());
         return null;
      } catch (error: any) {
         return { name: error.name, code: error.code };
      }
   },
};

describeElectron(
   "serializer of port channels in a sandboxed window",
   "serializer-ports",
   scenarios,
   (group) => {
      it("runs every scenario to completion, without uncaught errors in the main process", () => {
         const failed = Object.entries(group.run().results).filter(([, result]) => !result.ok);
         expect(failed).toStrictEqual([]);
         expect(group.run().uncaught).toStrictEqual([]);
      });

      it("delivers a Date and a Set between two pages as they were sent", () => {
         expect(group.value("trackerBetweenPages")).toStrictEqual({
            a: [{ isDate: true, time: 2000, isSet: true, tags: [] }],
            b: [{ isDate: true, time: 1000, isSet: true, tags: ["x", "y"] }],
         });
      });

      it("serializes the message that the channel queued before the pages had a port", () => {
         expect(group.value("trackerQueuedBeforeReady")).toStrictEqual([
            { isDate: true, time: 3000, isSet: true, tags: ["queued"] },
         ]);
      });

      // contextBridge turns what the preload script throws synchronously into an `Error` with the
      // message only, so the page tells the failure by the code in the message.
      it("throws from a send that cannot be serialized, with the code in the message, and sends nothing", () => {
         const { thrown, b } = group.value<any>("trackerUnserializable");

         expect(thrown.message).toMatch(
            /^\[IPC_SERIALIZATION\] The data cannot be serialized of the channel 'tracker': /,
         );
         expect(thrown.code).toBeUndefined();
         expect(b).toStrictEqual(["ready"]);
      });

      it("delivers a Date and a Map from the main process to the page as they were sent", () => {
         expect(group.value("feedMainToPage")).toStrictEqual([
            { isDate: true, time: 4000, isMap: true, counts: [["ada", 2]] },
         ]);
      });

      it("delivers a Date and a Map from the page to the main process as they were sent", () => {
         expect(group.value("feedPageToMain")).toStrictEqual([
            { isDate: true, time: 5000, isMap: true, counts: [["grace", 3]] },
         ]);
      });

      it("serializes the message that main queued until the page had loaded", () => {
         expect(group.value("feedQueuedBeforeLoad")).toStrictEqual([
            { isDate: true, time: 6000, isMap: true, counts: [["queued", 1]] },
         ]);
      });

      it("throws an IpcSerializationError in the main process from a send that cannot be serialized", () => {
         expect(group.value("feedUnserializable")).toStrictEqual({
            name: "IpcSerializationError",
            code: "IPC_SERIALIZATION",
         });
      });
   },
   { trackerPage, feedPage },
);
