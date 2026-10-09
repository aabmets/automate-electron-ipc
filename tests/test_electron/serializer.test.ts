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

// Runs the generated serializer in a real Electron process: the serializer module is bundled into
// the sandboxed preload script (the runner inlines it, as a bundler would), and the values cross
// the real ipcMain, ipcRenderer, contextBridge and the ports of a stream.

import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   invokeRoundTrip: async (ctx) => {
      const win = await ctx.open();
      const seen: any[] = [];
      ctx.ipc.getAppointment.handle(async (_event: unknown, id: number, since: Date) => {
         seen.push({ id, isDate: since instanceof Date, time: since.getTime() });
         return {
            at: since,
            tags: new Set(["a", "b"]),
            attendees: new Map([["ada", 2]]),
            budget: 10n,
         };
      });
      const page = await ctx.evaluate(win, async () => {
         const result = await ipc.getAppointment.invoke(7, new Date(1000));
         return {
            atIsDate: result.at instanceof Date,
            time: result.at.getTime(),
            tags: [...result.tags],
            tagsIsSet: result.tags instanceof Set,
            attendees: [...result.attendees],
            attendeesIsMap: result.attendees instanceof Map,
            budget: String(result.budget),
            budgetType: typeof result.budget,
         };
      });
      return { seen, page };
   },

   sendRoundTrip: async (ctx) => {
      const win = await ctx.open();
      const heard: any[] = [];
      ctx.ipc.logVisit.on((_event: unknown, at: Date, tags: Map<string, number>) => {
         heard.push({ isDate: at instanceof Date, time: at.getTime(), tags: [...tags] });
      });
      await ctx.evaluate(win, () => ipc.logVisit.send(new Date(2000), new Map([["x", 1]])));
      await ctx.waitFor(() => heard.length > 0, "the message arrives");
      return heard;
   },

   emitRoundTrip: async (ctx) => {
      const win = await ctx.open();
      await ctx.evaluate(win, () => {
         (globalThis as any).heard = [];
         ipc.changed.on((appointment: any) => {
            (globalThis as any).heard.push({
               isDate: appointment.at instanceof Date,
               time: appointment.at.getTime(),
               tags: [...appointment.tags],
               budget: String(appointment.budget),
            });
         });
      });
      ctx.ipc.changed.send(win, {
         at: new Date(3000),
         tags: new Set(["t"]),
         attendees: new Map(),
         budget: 5n,
      });
      return await ctx.until(win, () => {
         const heard = (globalThis as any).heard;
         return heard.length > 0 ? heard : null;
      });
   },

   askRoundTrip: async (ctx) => {
      const win = await ctx.open();
      await ctx.evaluate(win, () => {
         ipc.askClock.handle(async (zone: string) => new Date(zone === "UTC" ? 4000 : 0));
      });
      const answer = await ctx.ipc.askClock.invoke(win, "UTC");
      return { isDate: answer instanceof Date, time: answer.getTime() };
   },

   streamRoundTrip: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.history.handle(async function* (_event: unknown, since: Date) {
         yield {
            at: since,
            tags: new Set(["s"]),
            attendees: new Map(),
            budget: 1n,
         };
         yield {
            at: new Date(since.getTime() + 1),
            tags: new Set(),
            attendees: new Map(),
            budget: 2n,
         };
      });
      return await ctx.evaluate(win, async () => {
         const chunks: any[] = [];
         for await (const chunk of ipc.history.stream(new Date(5000))) {
            chunks.push({
               isDate: chunk.at instanceof Date,
               time: chunk.at.getTime(),
               tags: [...chunk.tags],
               budget: String(chunk.budget),
            });
         }
         return chunks;
      });
   },

   validated: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.checked.handle(async (_event: unknown, when: Date) => new Date(when.getTime() + 1));
      return await ctx.evaluate(win, async () => {
         const ok = await ipc.checked.invoke(new Date(10));
         return { isDate: ok instanceof Date, time: ok.getTime() };
      });
   },

   unserializable: async (ctx) => {
      const win = await ctx.open();
      return await ctx.evaluate(win, async () => {
         try {
            await ipc.getAppointment.invoke(1, () => 1);
            return { rejected: false };
         } catch (error: any) {
            return { rejected: true, name: error.name, code: error.code };
         }
      });
   },

   noArguments: async (ctx) => {
      const win = await ctx.open();
      let called = 0;
      ctx.ipc.ping.handle(async () => {
         called++;
      });
      const reply = await ctx.evaluate(win, async () => {
         try {
            await ipc.ping.invoke();
            return { rejected: false };
         } catch (error: any) {
            return { rejected: true, code: error.code };
         }
      });
      return { reply, called };
   },
};

describeElectron("serializer in a sandboxed window", "serializer", scenarios, (group) => {
   it("brings a Date to the handler and a Date, a Set, a Map and a bigint back to the page", () => {
      expect(group.value("invokeRoundTrip")).toStrictEqual({
         seen: [{ id: 7, isDate: true, time: 1000 }],
         page: {
            atIsDate: true,
            time: 1000,
            tags: ["a", "b"],
            tagsIsSet: true,
            attendees: [["ada", 2]],
            attendeesIsMap: true,
            budget: "10",
            budgetType: "bigint",
         },
      });
   });

   it("delivers the arguments of a send as they were", () => {
      expect(group.value("sendRoundTrip")).toStrictEqual([
         { isDate: true, time: 2000, tags: [["x", 1]] },
      ]);
   });

   it("delivers the arguments of an emit as they were", () => {
      expect(group.value("emitRoundTrip")).toStrictEqual([
         { isDate: true, time: 3000, tags: ["t"], budget: "5" },
      ]);
   });

   it("brings the answer of an ask back as it was", () => {
      expect(group.value("askRoundTrip")).toStrictEqual({ isDate: true, time: 4000 });
   });

   it("delivers the chunks of a stream as they were", () => {
      expect(group.value("streamRoundTrip")).toStrictEqual([
         { isDate: true, time: 5000, tags: ["s"], budget: "1" },
         { isDate: true, time: 5001, tags: [], budget: "2" },
      ]);
   });

   it("validates the arguments after they were deserialized", () => {
      expect(group.value("validated")).toStrictEqual({ isDate: true, time: 11 });
   });

   it("rejects a call whose arguments cannot be serialized, with the plain error object", () => {
      expect(group.value("unserializable")).toStrictEqual({
         rejected: true,
         name: "IpcSerializationError",
         code: "IPC_SERIALIZATION",
      });
   });

   it("serializes a call without arguments and without a result", () => {
      expect(group.value("noArguments")).toStrictEqual({
         reply: { rejected: false },
         called: 1,
      });
   });
});
