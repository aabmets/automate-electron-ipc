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

// Calls and notifications from a utility process to the main process, in a real Electron process (see
// utility.calls.test.ts).

import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;
declare const IpcUtilityError: any;

const scenarios: Record<string, Scenario> = {
   fromChild: async (ctx) => {
      const seen: unknown[] = [];
      let settingCalls = 0;
      const child = await ctx.fork(() => {
         ipc.start.on(async (total: number) => {
            for (let done = 1; done <= total; done++) {
               ipc.progress.send(done, total);
            }
         });
         ipc.viaMain.handle(async (key: string) => `${await ipc.getSetting.invoke(key)}!`);
      });
      ctx.ipc.progress.on(child, (done: number, total: number) => seen.push([done, total]));
      ctx.ipc.getSetting.handle(child, async (key: string) => {
         settingCalls++;
         return `value of ${key}`;
      });

      ctx.ipc.start.send(child, 3);
      const viaMain = await ctx.ipc.viaMain.invoke(child, "theme");
      await ctx.waitFor(() => seen.length === 3, "the progress messages");
      return { seen, viaMain, settingCalls };
   },

   mainFailureReachesChild: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.viaMain.handle(async (key: string) => {
            try {
               await ipc.getSetting.invoke(key);
               return "no error";
            } catch (error: any) {
               return JSON.stringify({
                  isUtilityError: error instanceof IpcUtilityError,
                  name: error.name,
                  message: error.message,
                  code: error.code,
                  data: error.data,
               });
            }
         });
      });
      // The child calls before the main process has a handler for it, once the peer is attached.
      ctx.main.attachUtility(child);
      const unhandled = JSON.parse(await ctx.ipc.viaMain.invoke(child, "missing"));
      ctx.ipc.getSetting.handle(child, async () => {
         throw Object.assign(new Error("denied"), { code: "E_DENIED", data: { who: "child" } });
      });
      const denied = JSON.parse(await ctx.ipc.viaMain.invoke(child, "secret"));
      return { unhandled, denied };
   },
};

describeElectron(
   "utility channel calls from the child in Electron",
   "electron-utility",
   scenarios,
   (group) => {
      it("delivers the notifications of the child, and the calls of the child to the main process", () => {
         expect(group.value("fromChild")).toStrictEqual({
            seen: [
               [1, 3],
               [2, 3],
               [3, 3],
            ],
            viaMain: "value of theme!",
            settingCalls: 1,
         });
      });

      it("rejects a call of the child with the error of the handler, or IPC_UTILITY_NO_HANDLER", () => {
         const { unhandled, denied } = group.value("mainFailureReachesChild");
         expect(unhandled).toMatchObject({
            isUtilityError: true,
            name: "IpcUtilityError",
            code: "IPC_UTILITY_NO_HANDLER",
         });
         expect(denied).toStrictEqual({
            isUtilityError: true,
            name: "Error",
            message: "denied",
            code: "E_DENIED",
            data: { who: "child" },
         });
      });
   },
);
