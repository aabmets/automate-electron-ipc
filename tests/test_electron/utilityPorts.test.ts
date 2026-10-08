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

// Channels from a page to a utility process, in a real Electron process: the main process forks a
// real `utilityProcess` and brokers a `MessageChannelMain` between it and a sandboxed window, and
// the page calls the child over the port without a hop through the main process.

// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures

import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
import { expect, it } from "vitest";

declare const ipc: any;

const scenarios: Record<string, Scenario> = {
   invoke: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.query.handle(async (sql: string, limit?: number) =>
            Array.from({ length: limit ?? 1 }, (_, id) => ({ id, label: `${sql} ${id}` })),
         );
         ipc.whoami.handle(async () => process.pid);
      });
      const win = await ctx.open();
      ctx.ipc.query.connect(child, win);
      ctx.ipc.whoami.connect(child, win);
      const page = await ctx.evaluate(win, async () => ({
         rows: await ipc.query.invoke("select", 2),
         pid: await ipc.whoami.invoke(),
      }));
      return { ...page, childPid: child.pid, mainPid: process.pid };
   },

   concurrent: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.query.handle(async (sql: string) => {
            await new Promise((resolve) => setTimeout(resolve, sql === "slow" ? 200 : 10));
            return [{ id: 0, label: sql }];
         });
      });
      const win = await ctx.open();
      ctx.ipc.query.connect(child, win);
      return await ctx.evaluate(win, async () => {
         const order: string[] = [];
         const call = (sql: string) =>
            ipc.query.invoke(sql).then((rows: { label: string }[]) => {
               order.push(sql);
               return rows[0].label;
            });
         // The slow call is made first, and is answered last.
         const answers = await Promise.all([call("slow"), call("a"), call("b")]);
         return { answers, order };
      });
   },

   errors: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.fail.handle(async () => {
            throw Object.assign(new RangeError("out of range"), {
               code: "E_RANGE",
               data: { at: 3 },
            });
         });
         // A function cannot be cloned, so the reply cannot be posted.
         ipc.unsendable.handle(() => () => undefined);
         // Registered, so that the process has a handler for another channel.
         ipc.whoami.handle(async () => 1);
      });
      const win = await ctx.open();
      for (const channel of [ctx.ipc.fail, ctx.ipc.unregistered, ctx.ipc.unsendable]) {
         channel.connect(child, win);
      }
      return await ctx.evaluate(win, async () => {
         const settle = (call: Promise<unknown>) =>
            call.then(
               () => null,
               (error: any) => ({
                  name: error.name,
                  message: error.message,
                  code: error.code,
                  data: error.data,
                  isError: error instanceof Error,
               }),
            );
         return {
            fail: await settle(ipc.fail.invoke()),
            unregistered: await settle(ipc.unregistered.invoke()),
            unsendable: await settle(ipc.unsendable.invoke()),
         };
      });
   },

   waitsForConnect: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.query.handle(async (sql: string) => [{ id: 1, label: sql }]);
      });
      const win = await ctx.open();
      await ctx.evaluate(win, () => {
         (globalThis as any).early = ipc.query.invoke("early");
      });
      const before = await ctx.evaluate(win, () =>
         Promise.race([
            (globalThis as any).early.then(() => "answered"),
            new Promise((resolve) => setTimeout(() => resolve("waiting"), 150)),
         ]),
      );
      ctx.ipc.query.connect(child, win);
      const after = await ctx.evaluate(win, () => (globalThis as any).early);
      return { before, after };
   },

   streams: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.count.handle(async function* (to: number) {
            for (let n = 1; n <= to; n++) {
               yield n;
            }
         });
         ipc.broken.handle(async function* (failAt: number) {
            for (let n = 1; ; n++) {
               if (n === failAt) {
                  throw Object.assign(new Error("the stream failed"), {
                     code: "E_BROKEN",
                     data: { at: n },
                  });
               }
               yield n;
            }
         });
      });
      const win = await ctx.open();
      ctx.ipc.count.connect(child, win);
      ctx.ipc.broken.connect(child, win);
      return await ctx.evaluate(win, async () => {
         const collect = async (stream: AsyncIterable<number>) => {
            const chunks: number[] = [];
            for await (const n of stream) {
               chunks.push(n);
            }
            return chunks;
         };
         const chunks = await collect(ipc.count.stream(4));
         const partial: number[] = [];
         let failure: unknown = null;
         try {
            for await (const n of ipc.broken.stream(3)) {
               partial.push(n);
            }
         } catch (error: any) {
            failure = {
               name: error.name,
               message: error.message,
               code: error.code,
               data: error.data,
            };
         }
         // Two streams of one channel share the port.
         const [a, b] = await Promise.all([
            collect(ipc.count.stream(2)),
            collect(ipc.count.stream(3)),
         ]);
         return { chunks, partial, failure, a, b };
      });
   },

   cancel: async (ctx) => {
      const child = await ctx.fork(() => {
         let finalized = false;
         ipc.endless.handle(async function* () {
            try {
               for (let n = 1; ; n++) {
                  yield n;
                  await new Promise((resolve) => setTimeout(resolve, 10));
               }
            } finally {
               finalized = true;
            }
         });
         ipc.finalized.handle(async () => finalized);
      });
      const win = await ctx.open();
      ctx.ipc.endless.connect(child, win);
      const page = await ctx.evaluate(win, async () => {
         const stream = ipc.endless.stream();
         const chunks: number[] = [];
         while (chunks.length < 3) {
            chunks.push((await stream.next()).value);
         }
         stream.cancel();
         return { chunks, afterCancel: await stream.next() };
      });
      await ctx.waitFor(() => ctx.ipc.finalized.invoke(child), "the generator to be finalized");
      return page;
   },

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

   withTheMainProcess: async (ctx) => {
      const child = await ctx.fork(() => {
         ipc.double.handle(async (n: number) => n * 2);
         ipc.query.handle(async (sql: string) => [{ id: 1, label: sql }]);
      });
      const win = await ctx.open();
      ctx.ipc.query.connect(child, win);
      const [fromPage, fromMain] = await Promise.all([
         ctx.evaluate(win, () => ipc.query.invoke("page")),
         ctx.ipc.double.invoke(child, 21),
      ]);
      return { fromPage, fromMain };
   },
};

describeElectron("utility ports in Electron", "electron-utility-ports", scenarios, (group) => {
   it("has no uncaught errors in the main process", () => {
      expect(group.run().uncaught).toStrictEqual([]);
   });

   it("calls the handlers of a real utility process from a sandboxed page, with no hop through main", () => {
      const result = group.value("invoke");
      expect(result.rows).toStrictEqual([
         { id: 0, label: "select 0" },
         { id: 1, label: "select 1" },
      ]);
      expect(result.pid).toBe(result.childPid);
      expect(result.pid).not.toBe(result.mainPid);
   });

   it("answers concurrent calls by their IDs", () => {
      expect(group.value("concurrent")).toStrictEqual({
         answers: ["slow", "a", "b"],
         order: ["a", "b", "slow"],
      });
   });

   it("rejects with the error of the handler as a plain object, and with the library's codes", () => {
      const { fail, unregistered, unsendable } = group.value("errors");
      expect(fail).toStrictEqual({
         name: "RangeError",
         message: "out of range",
         code: "E_RANGE",
         data: { at: 3 },
         isError: false,
      });
      expect(unregistered).toMatchObject({
         name: "IpcUtilityError",
         code: "IPC_UTILITY_NO_HANDLER",
      });
      expect(unsendable).toMatchObject({ name: "IpcUtilityError", code: "IPC_UTILITY_UNSENDABLE" });
   });

   it("holds a call which is made before the main process connects, and sends it afterwards", () => {
      expect(group.value("waitsForConnect")).toStrictEqual({
         before: "waiting",
         after: [{ id: 1, label: "early" }],
      });
   });

   it("streams the chunks in order, ends, fails with the error of the generator, and shares the port", () => {
      expect(group.value("streams")).toStrictEqual({
         chunks: [1, 2, 3, 4],
         partial: [1, 2],
         failure: {
            name: "Error",
            message: "the stream failed",
            code: "E_BROKEN",
            data: { at: 3 },
         },
         a: [1, 2],
         b: [1, 2, 3],
      });
   });

   it("stops the generator in the child when the page cancels the stream", () => {
      const { chunks, afterCancel } = group.value("cancel");
      expect(chunks).toStrictEqual([1, 2, 3]);
      expect(afterCancel).toStrictEqual({ done: true });
   });

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

   it("works next to the calls of the main process to the same child", () => {
      expect(group.value("withTheMainProcess")).toStrictEqual({
         fromPage: [{ id: 1, label: "page" }],
         fromMain: 42,
      });
   });
});
