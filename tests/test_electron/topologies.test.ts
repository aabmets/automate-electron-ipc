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

// One-to-many port topologies (T25) in real Electron: one hub window with several peers, each over
// a connection of its own, which the unit tests only ran with the `MessageChannel` of Node.

import { describeElectron, type ElectronGroup, type Scenario } from "@testutils/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

/**
 * A page which records the `chat` channel as a whole in `events`, and each connection in
 * `records`, with its handle in `handles` at the same index. A peer sends its name on each
 * connection once it is ready, so that the hub can tell its connections apart.
 */
const chatPage = `<!doctype html><title>chat</title><script>
   window.events = [];
   window.records = [];
   window.handles = [];
   ipc.chat.on((...args) => events.push(["message", ...args]));
   ipc.chat.onReady(() => events.push(["ready"]));
   ipc.chat.onClose(() => events.push(["close"]));
   ipc.chat.onConnection((connection) => {
      const record = { messages: [], ready: 0, closed: 0 };
      records.push(record);
      handles.push(connection);
      connection.on((msg) => record.messages.push(msg));
      connection.onReady(() => {
         record.ready += 1;
         const name = new URLSearchParams(location.search).get("name");
         if (name !== "hub") {
            connection.send(name);
         }
      });
      connection.onClose(() => (record.closed += 1));
   });
</script>`;

const scenarios: Record<string, Scenario> = {
   hubWithPeers: async (ctx) => {
      ctx.serve("app://main/chat.html", ctx.data.chatPage);
      const hub = await ctx.open({ url: "app://main/chat.html?name=hub" });
      const peers = [];
      for (const name of ["p1", "p2", "p3"]) {
         peers.push(await ctx.open({ url: `app://main/chat.html?name=${name}` }));
      }
      const connections = peers.map((peer) => ctx.ipc.chat.connect(hub, peer));
      // Every peer said its name on a connection of its own.
      const named = await ctx.until(
         hub,
         () =>
            (window as any).records.length === 3 &&
            (window as any).records.every((r: any) => r.messages.length === 1) &&
            (window as any).records.map((r: any) => r.messages[0]).sort(),
      );
      const indexOf = (name: string) =>
         ctx.evaluate(
            hub,
            (n: string) => (window as any).records.findIndex((r: any) => r.messages[0] === n),
            name,
         );

      // The connection of p2 reaches p2 only, and the channel reaches every peer.
      await ctx.evaluate(
         hub,
         (i: number) => (window as any).handles[i].send("only p2"),
         await indexOf("p2"),
      );
      await ctx.evaluate(hub, () => ipc.chat.send("to all"));
      const heard = [];
      for (const peer of peers) {
         heard.push(
            await ctx.until(
               peer,
               () =>
                  (window as any).events.some((e: unknown[]) => e[1] === "to all") &&
                  (window as any).events.filter((e: unknown[]) => e[0] === "message"),
            ),
         );
      }

      // p1 closes its connection from its page: the hub loses that peer only.
      await ctx.evaluate(peers[0], () => (window as any).handles[0].close());
      const p1 = await indexOf("p1");
      await ctx.until(hub, (i: number) => (window as any).records[i].closed === 1, p1);
      // The main process closes the connection of p3: the hub loses that peer only.
      connections[2].close();
      const p3 = await indexOf("p3");
      await ctx.until(hub, (i: number) => (window as any).records[i].closed === 1, p3);

      await ctx.evaluate(hub, () => ipc.chat.send("after the closes"));
      await ctx.until(peers[1], () =>
         (window as any).events.some((e: unknown[]) => e[1] === "after the closes"),
      );
      await ctx.sleep(300);
      const after = [];
      for (const peer of peers) {
         after.push(
            await ctx.evaluate(
               peer,
               () =>
                  (window as any).events.filter((e: unknown[]) => e[1] === "after the closes")
                     .length,
            ),
         );
      }
      const records = await ctx.evaluate(hub, () =>
         (window as any).records.map((r: any) => ({ name: r.messages[0], closed: r.closed })),
      );
      return {
         named,
         heard,
         after,
         records: records.sort((x: any, y: any) => x.name.localeCompare(y.name)),
         peerEvents: await ctx.evaluate(peers[0], () => (window as any).events),
      };
   },

   // A page that closed its connection ends it for good, so a reload of either page must not pair
   // the two again.
   closedStaysClosedOnReload: async (ctx) => {
      ctx.serve("app://main/chat.html", ctx.data.chatPage);
      const a = await ctx.open({ url: "app://main/chat.html?name=a" });
      const b = await ctx.open({ url: "app://main/chat.html?name=b" });
      ctx.ipc.chat.connect(a, b);
      await ctx.until(a, () => (window as any).records[0]?.ready === 1);
      await ctx.until(b, () => (window as any).records[0]?.ready === 1);
      await ctx.evaluate(a, () => (window as any).handles[0].close());
      await ctx.until(b, () => (window as any).records[0].closed === 1);
      b.webContents.reload();
      await new Promise((resolve) => b.webContents.once("did-finish-load", resolve));
      a.webContents.reload();
      await new Promise((resolve) => a.webContents.once("did-finish-load", resolve));
      await ctx.sleep(500);
      return {
         a: await ctx.evaluate(a, () => (window as any).events),
         b: await ctx.evaluate(b, () => (window as any).events),
      };
   },

   // A peer that reloads gets a new port on the same connection of the hub: no second connection.
   peerReloadKeepsTheConnection: async (ctx) => {
      ctx.serve("app://main/chat.html", ctx.data.chatPage);
      const hub = await ctx.open({ url: "app://main/chat.html?name=hub" });
      const p1 = await ctx.open({ url: "app://main/chat.html?name=p1" });
      const p2 = await ctx.open({ url: "app://main/chat.html?name=p2" });
      ctx.ipc.chat.connect(hub, p1);
      ctx.ipc.chat.connect(hub, p2);
      await ctx.until(
         hub,
         () =>
            (window as any).records.length === 2 &&
            (window as any).records.every((r: any) => r.messages.length === 1),
      );
      p1.webContents.reload();
      // The new page of p1 says its name again, on the connection which the hub already has.
      await ctx.until(hub, () => (window as any).records.some((r: any) => r.messages.length === 2));
      await ctx.sleep(300);
      return await ctx.evaluate(hub, () =>
         (window as any).records
            .map((r: any) => ({ messages: r.messages, ready: r.ready }))
            .sort((x: any, y: any) => x.messages[0].localeCompare(y.messages[0])),
      );
   },
};

describeElectron("one-to-many port topologies in Electron", "electron-ports", scenarios, body, {
   chatPage,
});

function body(group: ElectronGroup) {
   it("runs every scenario to completion, without uncaught errors in the main process", () => {
      const failed = Object.entries(group.run().results).filter(([, result]) => !result.ok);
      expect(failed).toStrictEqual([]);
      expect(group.run().uncaught).toStrictEqual([]);
   });

   it("gives the hub one connection per peer, and each peer only what is sent to it", () => {
      const { named, heard } = group.value("hubWithPeers");
      expect(named).toStrictEqual(["p1", "p2", "p3"]);
      expect(heard).toStrictEqual([
         [["message", "to all"]],
         [
            ["message", "only p2"],
            ["message", "to all"],
         ],
         [["message", "to all"]],
      ]);
   });

   it("closes one connection of the hub, from the page or from main, and keeps the others", () => {
      const { after, records, peerEvents } = group.value("hubWithPeers");
      expect(records).toStrictEqual([
         { name: "p1", closed: 1 },
         { name: "p2", closed: 0 },
         { name: "p3", closed: 1 },
      ]);
      expect(after).toStrictEqual([0, 1, 0]);
      expect(peerEvents).toStrictEqual([["ready"], ["message", "to all"], ["close"]]);
   });

   it("does not pair a connection again that a page closed, when the pages reload", () => {
      const { a, b } = group.value("closedStaysClosedOnReload");
      expect(a).toStrictEqual([]);
      expect(b).toStrictEqual([]);
   });

   it("pairs a reloaded peer on its connection of the hub, and makes no second one", () => {
      expect(group.value("peerReloadKeepsTheConnection")).toStrictEqual([
         { messages: ["p1", "p1"], ready: 2 },
         { messages: ["p2"], ready: 1 },
      ]);
   });
}
