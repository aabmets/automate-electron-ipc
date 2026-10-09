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

// What happens to the calls and the streams of a page when the connection or the child closes, in a
// real Electron process (see utilityPorts.calls.test.ts).

// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures

import { describeElectron, type Scenario } from "@testutils/electron/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   closeConnection: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.hang.handle(() => new Promise(() => undefined));
         ipc.query.handle(async (sql: string) => [{ id: 1, label: sql }]);
      });
      const win = await ctx.open();
      const hang = ctx.ipc.hang.connect(child, win);
      const query = ctx.ipc.query.connect(child, win);
      await ctx.evaluate(win, () => {
         (globalThis as any).pending = ipc.hang.invoke().then(
            () => null,
            (error: any) => ({ name: error.name, code: error.code }),
         );
      });
      await ctx.sleep(100);

      hang.close();
      const pending = await ctx.evaluate(win, () => (globalThis as any).pending);
      const later = await ctx.evaluate(win, () =>
         ipc.hang.invoke().then(
            () => null,
            (error: any) => error.code,
         ),
      );
      // The other channel is not affected, until it is closed, and works again when it is connected.
      const other = await ctx.evaluate(win, () => ipc.query.invoke("other"));
      query.close();
      const closed = await ctx.evaluate(win, () =>
         ipc.query.invoke("closed").then(
            () => null,
            (error: any) => error.code,
         ),
      );
      ctx.ipc.query.connect(child, win);
      const again = await ctx.evaluate(win, () => ipc.query.invoke("again"));
      return { pending, later, other, closed, again };
   },

   childExits: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.hang.handle(() => new Promise(() => undefined));
         ipc.count.handle(async function* () {
            yield 1;
            await new Promise(() => undefined);
         });
      });
      const win = await ctx.open();
      ctx.ipc.hang.connect(child, win);
      ctx.ipc.count.connect(child, win);
      await ctx.evaluate(win, async () => {
         (globalThis as any).pending = ipc.hang.invoke().then(
            () => null,
            (error: any) => ({ name: error.name, code: error.code }),
         );
         (globalThis as any).stream = ipc.count.stream(1);
         await (globalThis as any).stream.next();
         (globalThis as any).read = (globalThis as any).stream.next().then(
            () => null,
            (error: any) => ({ name: error.name, code: error.code }),
         );
      });
      await ctx.sleep(100);

      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
      const pending = await ctx.evaluate(win, () => (globalThis as any).pending);
      const read = await ctx.evaluate(win, () => (globalThis as any).read);
      const later = await ctx.until(win, async () => {
         const settled = await Promise.race([
            ipc.hang.invoke().then(
               () => "answered",
               (error: any) => error.code,
            ),
            new Promise((resolve) => setTimeout(() => resolve(null), 100)),
         ]);
         return settled === "IPC_UTILITY_EXITED" ? settled : null;
      });
      return { pending, read, later };
   },
};

describeElectron(
   "closing utility ports in Electron",
   "electron-utility-ports",
   scenarios,
   (group) => {
      it("fails the calls with IPC_UTILITY_EXITED when the main process closes the connection", () => {
         expect(group.value("closeConnection")).toStrictEqual({
            pending: { name: "IpcUtilityError", code: "IPC_UTILITY_EXITED" },
            later: "IPC_UTILITY_EXITED",
            other: [{ id: 1, label: "other" }],
            closed: "IPC_UTILITY_EXITED",
            again: [{ id: 1, label: "again" }],
         });
      });

      it("fails the calls and the streams that are open when the child exits, and the later calls", () => {
         expect(group.value("childExits")).toStrictEqual({
            pending: { name: "IpcUtilityError", code: "IPC_UTILITY_EXITED" },
            read: { name: "IpcUtilityError", code: "IPC_UTILITY_EXITED" },
            later: "IPC_UTILITY_EXITED",
         });
      });
   },
);
