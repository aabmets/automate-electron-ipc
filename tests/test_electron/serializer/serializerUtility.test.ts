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

// Runs the serializer of the channels with a utility process in a real Electron process: a real
// `utilityProcess` talks to the main process over `process.parentPort`, and a sandboxed window talks
// to it over a port that the main process brokers. The serializer module is required by the compiled
// `main.js` and `utility.js`, and bundled into the preload script by the runner.

// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures

import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   mainAndChild: async (ctx) => {
      const child = await ctx.fork(() => {
         let seen: unknown = null;
         ipc.shift.handle(async (at: Date, by: number) => {
            seen = { isDate: at instanceof Date, time: at.getTime() };
            if (by < 0) {
               return (() => 1) as any;
            }
            return new Date(at.getTime() + by);
         });
         ipc.tell.on(async (at: Date, tags: Set<string>) => {
            const now = await ipc.clock.invoke();
            ipc.tick.send(
               at,
               new Map([
                  ["tags", tags.size],
                  ["nowIsDate", now instanceof Date ? 1 : 0],
                  ["nowTime", now.getTime()],
               ]),
            );
         });
         ipc.tell.on(() => {
            ipc.tick.send(new Date(seen ? (seen as any).time : -1), new Map([["seen", 1]]));
         });
      });
      ctx.main.attachUtility(child);
      ctx.ipc.clock.handle(child, async () => new Date(2000));
      const ticks: any[] = [];
      ctx.ipc.tick.on(child, (at: Date, counts: Map<string, number>) => {
         ticks.push({ isDate: at instanceof Date, time: at.getTime(), counts: [...counts] });
      });

      const shifted = await ctx.ipc.shift.invoke(child, new Date(1000), 500);
      ctx.ipc.tell.send(child, new Date(3000), new Set(["a", "b"]));
      await ctx.waitFor(() => ticks.length >= 2, "both ticks of the child");
      return {
         shifted: { isDate: shifted instanceof Date, time: shifted.getTime() },
         ticks: ticks.sort((a, b) => a.counts.length - b.counts.length),
      };
   },

   mainFailures: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.shift.handle(async (at: Date, by: number) =>
            by < 0 ? ((() => 1) as any) : new Date(at.getTime() + by),
         );
      });
      const describe = (error: any) => ({
         name: error.name,
         code: error.code,
         isSerializationError: error instanceof ctx.main.IpcSerializationError,
         isUtilityError: error instanceof ctx.main.IpcUtilityError,
      });
      // The arguments cannot be serialized: nothing is sent, and the call rejects in the main process.
      const unserializableArgument = await ctx.ipc.shift
         .invoke(child, () => 1, 1)
         .then(() => null, describe);
      // The result cannot be serialized in the child, which answers with the error.
      const unserializableResult = await ctx.ipc.shift
         .invoke(child, new Date(0), -1)
         .then(() => null, describe);
      let thrown: unknown = null;
      try {
         ctx.ipc.tell.send(child, () => 1, new Set());
      } catch (error) {
         thrown = describe(error);
      }
      // The child is alive and still answers.
      const after = await ctx.ipc.shift.invoke(child, new Date(1000), 1);
      return { unserializableArgument, unserializableResult, thrown, after: after.getTime() };
   },

   pageAndChild: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.lookup.handle(
            async (at: Date) =>
               new Map<string, Date>([
                  ["at", at],
                  ["seenAsDate", new Date(at instanceof Date ? 1 : 0)],
               ]),
         );
         ipc.dates.handle(async function* (since: Date) {
            yield since;
            yield new Date(since.getTime() + 1000);
         });
      });
      const win = await ctx.open();
      ctx.ipc.lookup.connect(child, win);
      ctx.ipc.dates.connect(child, win);
      return await ctx.evaluate(win, async () => {
         const found = await ipc.lookup.invoke(new Date(1000));
         const times: number[] = [];
         let allDates = true;
         for await (const at of ipc.dates.stream(new Date(5000))) {
            allDates = allDates && at instanceof Date;
            times.push(at.getTime());
         }
         return {
            isMap: found instanceof Map,
            atIsDate: found.get("at") instanceof Date,
            atTime: found.get("at").getTime(),
            childSawADate: found.get("seenAsDate").getTime(),
            allDates,
            times,
         };
      });
   },

   pageFailures: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.lookup.handle(async () => new Map<string, Date>());
         ipc.dates.handle(async function* (since: Date) {
            yield since;
            yield (() => 1) as any;
            yield since;
         });
      });
      const win = await ctx.open();
      ctx.ipc.lookup.connect(child, win);
      ctx.ipc.dates.connect(child, win);
      return await ctx.evaluate(win, async () => {
         const describe = (error: any) => ({ name: error.name, code: error.code });
         const argument = await ipc.lookup.invoke(() => 1).then(() => null, describe);
         const streamArgument = await ipc.dates
            .stream(() => 1)
            .next()
            .then(() => null, describe);
         // The second chunk cannot be serialized in the child, which fails the stream with the error.
         const stream = ipc.dates.stream(new Date(0));
         const first = (await stream.next()).value.getTime();
         const chunk = await stream.next().then(() => null, describe);
         const after = await ipc.lookup
            .invoke(new Date(0))
            .then((value: Map<string, Date>) => value.size);
         return { argument, streamArgument, first, chunk, after };
      });
   },
};

describeElectron(
   "serializer of the channels with a utility process, in real Electron processes",
   "serializer-utility",
   scenarios,
   (group) => {
      it("runs every scenario to completion, without uncaught errors in the main process", () => {
         const failed = Object.entries(group.run().results).filter(([, result]) => !result.ok);
         expect(failed).toStrictEqual([]);
         expect(group.run().uncaught).toStrictEqual([]);
      });

      it("delivers Dates, Sets and Maps between the main process and the utility process as they were", () => {
         expect(group.value("mainAndChild")).toStrictEqual({
            shifted: { isDate: true, time: 1500 },
            ticks: [
               { isDate: true, time: 1000, counts: [["seen", 1]] },
               {
                  isDate: true,
                  time: 3000,
                  counts: [
                     ["tags", 2],
                     ["nowIsDate", 1],
                     ["nowTime", 2000],
                  ],
               },
            ],
         });
      });

      it("fails a call or a send that cannot be serialized, in both directions, and the child goes on", () => {
         expect(group.value("mainFailures")).toStrictEqual({
            unserializableArgument: {
               name: "IpcSerializationError",
               code: "IPC_SERIALIZATION",
               isSerializationError: true,
               isUtilityError: false,
            },
            unserializableResult: {
               name: "IpcSerializationError",
               code: "IPC_SERIALIZATION",
               isSerializationError: false,
               isUtilityError: true,
            },
            thrown: {
               name: "IpcSerializationError",
               code: "IPC_SERIALIZATION",
               isSerializationError: true,
               isUtilityError: false,
            },
            after: 1001,
         });
      });

      it("delivers a Date and a Map over the brokered port, in the arguments, results and chunks", () => {
         expect(group.value("pageAndChild")).toStrictEqual({
            isMap: true,
            atIsDate: true,
            atTime: 1000,
            childSawADate: 1,
            allDates: true,
            times: [5000, 6000],
         });
      });

      it("fails the calls and the streams of the page that cannot be serialized, and the port goes on", () => {
         const { argument, streamArgument, first, chunk, after } = group.value<any>("pageFailures");

         expect(first).toBe(0);
         expect(after).toBe(0);
         // The calls reject with a plain object, which contextBridge carries with its fields (T82 is about
         // the errors that the preload script throws synchronously).
         for (const failure of [argument, streamArgument, chunk]) {
            expect(failure).toStrictEqual({
               name: "IpcSerializationError",
               code: "IPC_SERIALIZATION",
            });
         }
      });
   },
);
