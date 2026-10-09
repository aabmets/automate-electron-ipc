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

// Runs the serializer of the channels with a service worker in real Electron processes: a real
// service worker runs the generated preload script (sandboxed, with contextBridge), which talks to
// the generated `main.ts`. The serializer module is required by the compiled `main.js` and bundled
// into the preload script of the worker by the runner.

// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures

import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   // The worker calls the main process with a Date, and gets a Date back.
   workerCalls: async (ctx) => {
      const ses = ctx.workerSession();
      const seen: unknown[] = [];
      ctx.ipc.shift.handle(ses, async (_event: unknown, at: Date, by: number) => {
         seen.push({ isDate: at instanceof Date, time: at.getTime() });
         return by < 0 ? ((() => 1) as any) : new Date(at.getTime() + by);
      });
      ctx.ipc.checked.handle(ses, (_event: unknown, at: Date) => at);
      const { win } = await ctx.startWorker(ses);
      return await ctx.inWorker(win, async () => {
         const describe = (error: any) => ({ name: error.name, code: error.code });
         const shifted = await ipc.shift.invoke(new Date(1000), 500);
         const checked = await ipc.checked.invoke(new Date(7000));
         // The arguments cannot be serialized: nothing is sent, and the call rejects in the worker.
         const unserializableArgument = await ipc.shift
            .invoke(() => 1, 1)
            .then(() => null, describe);
         // The result cannot be serialized in the main process, which answers with the error.
         const unserializableResult = await ipc.shift
            .invoke(new Date(0), -1)
            .then(() => null, describe);
         return {
            shifted: { isDate: shifted instanceof Date, time: shifted.getTime() },
            checked: { isDate: checked instanceof Date, time: checked.getTime() },
            unserializableArgument,
            unserializableResult,
         };
      });
   },

   // The worker sends Dates, Sets and Maps to listeners of the main process.
   workerSends: async (ctx) => {
      const ses = ctx.workerSession();
      const heard: any[] = [];
      ctx.ipc.tell.on(ses, (_event: unknown, at: Date, tags: Set<string>) => {
         heard.push({ isDate: at instanceof Date, time: at.getTime(), tags: [...tags] });
      });
      ctx.ipc.checkedTell.on(ses, (_event: unknown, at: Date) => {
         heard.push({ checked: at instanceof Date, time: at.getTime() });
      });
      const { win } = await ctx.startWorker(ses);
      const thrown = await ctx.inWorker(win, () => {
         ipc.tell.send(new Date(2000), new Set(["a", "b"]));
         ipc.checkedTell.send(new Date(3000));
         try {
            ipc.tell.send(() => 1, new Set());
            return null;
         } catch (error: any) {
            return { name: error.name, code: error.code, message: error.message };
         }
      });
      await ctx.waitFor(() => heard.length >= 2, "both messages of the worker");
      return { heard, thrown };
   },

   // The main process asks the worker and sends to it.
   mainToWorker: async (ctx) => {
      const ses = ctx.workerSession();
      ctx.main.attachServiceWorkers(ses);
      const { win, worker } = await ctx.startWorker(ses);
      await ctx.inWorker(win, () => {
         const g = globalThis as any;
         g.heard = [];
         ipc.zone.handle(async (at: Date) => new Map([["at", at]]));
         ipc.tick.on((at: Date, counts: Map<string, number>) => {
            g.heard.push({ isDate: at instanceof Date, time: at.getTime(), counts: [...counts] });
         });
      });
      const answer = await ctx.ipc.zone.invoke(worker, new Date(4000));
      const unserializable = await ctx.ipc.zone.invoke(worker, (() => 1) as any).then(
         () => null,
         (error: any) => ({
            name: error.name,
            code: error.code,
            isSerializationError: error instanceof ctx.main.IpcSerializationError,
         }),
      );
      ctx.ipc.tick.send(worker, new Date(5000), new Map([["a", 1]]));
      ctx.ipc.tick.broadcast(ses, new Date(6000), new Map([["b", 2]]));
      const heard = await ctx.waitFor(async () => {
         const got = await ctx.inWorker(win, () => (globalThis as any).heard);
         return got.length >= 2 ? got : null;
      }, "two messages of the main process");
      return {
         answer: { isMap: answer instanceof Map, atIsDate: answer.get("at") instanceof Date },
         answerTime: answer.get("at").getTime(),
         unserializable,
         heard,
      };
   },
};

describeElectron(
   "serializer of the channels with a service worker, in real Electron processes",
   "serializer-worker",
   scenarios,
   (group) => {
      it("runs every scenario to completion, without uncaught errors in the main process", () => {
         const failed = Object.entries(group.run().results).filter(([, result]) => !result.ok);
         expect(failed).toStrictEqual([]);
         expect(group.run().uncaught).toStrictEqual([]);
      });

      it("brings a Date to the handler and a Date back to the worker, and fails what cannot be serialized", () => {
         expect(group.value("workerCalls")).toStrictEqual({
            shifted: { isDate: true, time: 1500 },
            checked: { isDate: true, time: 7000 },
            unserializableArgument: { name: "IpcSerializationError", code: "IPC_SERIALIZATION" },
            unserializableResult: { name: "IpcSerializationError", code: "IPC_SERIALIZATION" },
         });
      });

      it("delivers the messages of the worker with their Dates and Sets, after the validation of the schema", () => {
         expect(group.value<any>("workerSends").heard).toStrictEqual([
            { isDate: true, time: 2000, tags: ["a", "b"] },
            { checked: true, time: 3000 },
         ]);
      });

      // contextBridge turns what the preload script throws synchronously into an `Error` with the
      // message only, so the worker tells the failure by the code in the message.
      it("throws from a send that cannot be serialized, with the code in the message", () => {
         const { thrown } = group.value<any>("workerSends");

         expect(thrown.message).toMatch(
            /^\[IPC_SERIALIZATION\] The data cannot be serialized of the channel 'tell': /,
         );
         expect(thrown.code).toBeUndefined();
      });

      it("asks the worker with a Date and gets a Map of Dates, and sends it a Date and a Map", () => {
         expect(group.value("mainToWorker")).toStrictEqual({
            answer: { isMap: true, atIsDate: true },
            answerTime: 4000,
            unserializable: {
               name: "IpcSerializationError",
               code: "IPC_SERIALIZATION",
               isSerializationError: true,
            },
            heard: [
               { isDate: true, time: 5000, counts: [["a", 1]] },
               { isDate: true, time: 6000, counts: [["b", 2]] },
            ],
         });
      });
   },
);
