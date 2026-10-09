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

// Runs the generated invoke, send and emit bindings in a real Electron process: a sandboxed,
// context-isolated page talks to the generated main process code through the real ipcMain.
// The scenario functions are turned into text and run in Electron, so they use nothing from this
// file but `ctx`, and the page code in them uses the `ipc` global which the preload script exposes.

import { runFixture } from "@testutils/e2e-utils.js";
import { describeElectron, type Scenario } from "@testutils/electron-utils.js";
import { describe, expect, it } from "vitest";

declare const ipc: any;
declare const __env: any;
declare const document: any;

const scenarios: Record<string, Scenario> = {
   environment: async (ctx) => {
      const win = await ctx.open();
      return await ctx.evaluate(win, () => ({
         env: __env,
         members: Object.keys(ipc).sort(),
         invoke: typeof ipc.getValue.invoke,
      }));
   },

   invokeValue: async (ctx) => {
      const win = await ctx.open();
      const seen: unknown[] = [];
      ctx.ipc.getValue.handle(async (event: any, id: number) => {
         seen.push({ url: event.senderFrame.url, origin: event.senderFrame.origin, id });
         return `user ${id}`;
      });
      const value = await ctx.evaluate(win, () => ipc.getValue.invoke(7));
      return { value, seen };
   },

   invokeError: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.fail.handle(async (_event: unknown, id: number) => {
         const error = new Error("the app failed") as Error & { code: string; data: unknown };
         error.name = "AppError";
         error.code = "E_APP";
         error.data = { id, tags: ["a", "b"] };
         throw error;
      });
      return await ctx.evaluate(win, async () => {
         try {
            await ipc.fail.invoke(3);
            return { rejected: false };
         } catch (error: any) {
            return {
               rejected: true,
               isError: error instanceof Error,
               name: error.name,
               message: error.message,
               code: error.code,
               data: error.data,
               keys: Object.keys(error).sort(),
            };
         }
      });
   },

   invokeNoHandler: async (ctx) => {
      const win = await ctx.open();
      return await ctx.evaluate(win, async () => {
         try {
            await ipc.missing.invoke();
            return { rejected: false };
         } catch (error: any) {
            return { rejected: true, message: String(error?.message ?? error) };
         }
      });
   },

   handleOnce: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.once.handleOnce(async () => 42);
      return await ctx.evaluate(win, async () => {
         const first = await ipc.once.invoke();
         let second: unknown;
         try {
            second = { value: await ipc.once.invoke() };
         } catch (error: any) {
            second = { message: String(error?.message ?? error) };
         }
         return { first, second };
      });
   },

   handlerReplaced: async (ctx) => {
      const win = await ctx.open();
      const invoke = () =>
         ctx.evaluate(win, async () => {
            try {
               return { value: await ipc.replaced.invoke() };
            } catch (error: any) {
               return { message: String(error?.message ?? error) };
            }
         });
      const offFirst = ctx.ipc.replaced.handle(async () => "first");
      const before = await invoke();
      const offSecond = ctx.ipc.replaced.handle(async () => "second");
      const replaced = await invoke();
      // The disposer of a handler which was replaced must not remove the handler which replaced it.
      offFirst();
      const afterStale = await invoke();
      offSecond();
      const afterOwn = await invoke();
      return { before, replaced, afterStale, afterOwn };
   },

   sendArguments: async (ctx) => {
      const win = await ctx.open();
      const logged: unknown[][] = [];
      const optional: unknown[][] = [];
      // JSON has no undefined, so it is written out.
      const show = (args: unknown[]) => args.map((arg) => (arg === undefined ? "undefined" : arg));
      ctx.ipc.log.on((_event: unknown, ...args: unknown[]) => logged.push(show(args)));
      ctx.ipc.optional.on((_event: unknown, ...args: unknown[]) => optional.push(show(args)));
      await ctx.evaluate(win, () => {
         ipc.log.send("a");
         ipc.log.send("b", 1, 2, 3);
         ipc.optional.send("x");
         ipc.optional.send("y", 5);
      });
      await ctx.waitFor(() => logged.length === 2 && optional.length === 2);
      return { logged, optional };
   },

   sendOnce: async (ctx) => {
      const win = await ctx.open();
      const got: unknown[][] = [];
      ctx.ipc.log.once((_event: unknown, ...args: unknown[]) => got.push(args));
      await ctx.evaluate(win, () => {
         ipc.log.send("first");
         ipc.log.send("second");
      });
      await ctx.waitFor(() => got.length > 0);
      await ctx.sleep(200);
      return got;
   },

   // The disposers of the listeners on both sides (T14, T15), which cross the context bridge in
   // the page.
   listenerDisposers: async (ctx) => {
      const win = await ctx.open();
      const kept: unknown[] = [];
      const removed: unknown[] = [];
      ctx.ipc.log.on((_event: unknown, text: string) => kept.push(text));
      const off = ctx.ipc.log.on((_event: unknown, text: string) => removed.push(text));
      const offOnce = ctx.ipc.log.once((_event: unknown, text: string) => removed.push(text));
      await ctx.evaluate(win, () => ipc.log.send("before"));
      await ctx.waitFor(() => kept.length === 1);
      off();
      offOnce();
      await ctx.evaluate(win, () => ipc.log.send("after"));
      await ctx.waitFor(() => kept.length === 2);

      await ctx.evaluate(win, () => {
         const got: Record<string, number[]> = { kept: [], removed: [], once: [], onceOff: [] };
         (window as any).got = got;
         ipc.tick.on((n: number) => got.kept.push(n));
         (window as any).off = ipc.tick.on((n: number) => got.removed.push(n));
         ipc.tick.once((n: number) => got.once.push(n));
         ipc.tick.once((n: number) => got.onceOff.push(n))();
      });
      ctx.ipc.tick.send(win, 1);
      await ctx.until(win, () => (window as any).got.kept.length === 1);
      await ctx.evaluate(win, () => (window as any).off());
      ctx.ipc.tick.send(win, 2);
      const page = await ctx.until(
         win,
         () => (window as any).got.kept.length === 2 && (window as any).got,
      );
      return {
         main: { kept, removed },
         page,
         listeners: ctx.electron.ipcMain.listenerCount("autoipc:log"),
      };
   },

   emitTargets: async (ctx) => {
      const { WebContentsView } = ctx.electron;
      const win = await ctx.open();
      const view = new WebContentsView({ webPreferences: ctx.webPreferences() });
      win.contentView.addChildView(view);
      await view.webContents.loadURL("app://main/view.html");
      const listen = (target: unknown) =>
         ctx.evaluate(target, () => {
            const received: unknown[][] = [];
            (window as any).received = received;
            // JSON has no undefined, so it is written out.
            ipc.notice.on((...args: unknown[]) =>
               received.push(args.map((arg) => (arg === undefined ? "undefined" : arg))),
            );
         });
      await listen(win);
      await listen(view);
      const frame = win.webContents.mainFrame;

      ctx.ipc.notice.send(win, "to window");
      ctx.ipc.notice.send(view, "to view", 1);
      ctx.ipc.notice.send(win.webContents, "to contents", 2);
      ctx.ipc.notice.send(frame, "to frame", 3);

      const read = (target: unknown) => ctx.evaluate(target, () => (window as any).received);
      await ctx.waitFor(
         async () => (await read(win)).length === 3 && (await read(view)).length === 1,
      );
      return { window: await read(win), view: await read(view) };
   },

   broadcast: async (ctx) => {
      const [a, b, c] = [await ctx.open(), await ctx.open(), await ctx.open()];
      const listen = (win: unknown) =>
         ctx.evaluate(win, () => {
            (window as any).ticks = [];
            ipc.tick.on((n: number) => (window as any).ticks.push(n));
         });
      await Promise.all([listen(a), listen(b), listen(c)]);
      const ticks = (win: unknown) => ctx.evaluate(win, () => (window as any).ticks);

      ctx.ipc.tick.broadcast(1);
      await ctx.waitFor(async () => (await ticks(c)).length === 1);
      const all = [await ticks(a), await ticks(b), await ticks(c)];

      ctx.ipc.tick.broadcastTo((contents: any) => contents.id === b.webContents.id, 2);
      await ctx.waitFor(async () => (await ticks(b)).length === 2);
      await ctx.sleep(100);
      const filtered = [await ticks(a), await ticks(b), await ticks(c)];

      // A window which was destroyed is not in the list of contents, and is not reached.
      c.destroy();
      let error: string | null = null;
      try {
         ctx.ipc.tick.broadcast(3);
         ctx.ipc.tick.broadcastTo(() => true, 4);
      } catch (cause: any) {
         error = String(cause?.message ?? cause);
      }
      await ctx.waitFor(async () => (await ticks(a)).length === 3 && (await ticks(b)).length === 4);
      await ctx.sleep(100);
      return { all, filtered, error, afterDestroy: [await ticks(a), await ticks(b)] };
   },

   scopedInvoke: async (ctx) => {
      const [a, b] = [await ctx.open(), await ctx.open()];
      const call = (win: unknown, id: number) =>
         ctx.evaluate(win, (n: number) => ipc.getValue.invoke(n), id);
      const dispose = [
         ctx.ipc.getValue.handle(async (_event: unknown, id: number) => `global ${id}`),
      ];
      const global = [await call(a, 1), await call(b, 1)];
      dispose.push(
         ctx.ipc.getValue.handle(async (_event: unknown, id: number) => `scoped ${id}`, {
            webContents: a.webContents,
         }),
      );
      const withScoped = [await call(a, 2), await call(b, 2)];
      // The registration on the contents is not the global one, so it does not replace it.
      dispose[1]();
      const afterDispose = [await call(a, 3), await call(b, 3)];
      return { global, withScoped, afterDispose };
   },

   scopedInvokeOnly: async (ctx) => {
      const [a, b] = [await ctx.open(), await ctx.open()];
      ctx.ipc.getValue.handle(async (_event: unknown, id: number) => `only ${id}`, {
         webContents: a.webContents,
      });
      const call = (win: unknown) =>
         ctx.evaluate(win, async () => {
            try {
               return { value: await ipc.getValue.invoke(1) };
            } catch (error: any) {
               return { message: String(error?.message ?? error) };
            }
         });
      return { a: await call(a), b: await call(b) };
   },

   scopedHandleOnce: async (ctx) => {
      const win = await ctx.open();
      ctx.ipc.getValue.handle(async () => "global");
      ctx.ipc.getValue.handleOnce(async () => "scoped once", { webContents: win.webContents });
      const call = () => ctx.evaluate(win, () => ipc.getValue.invoke(1));
      return [await call(), await call()];
   },

   scopedSend: async (ctx) => {
      const [a, b] = [await ctx.open(), await ctx.open()];
      const scoped: unknown[] = [];
      const global: unknown[] = [];
      const label = (event: any, text: string) =>
         `${event.sender.id === a.webContents.id ? "a" : "b"}:${text}`;
      ctx.ipc.log.on((event: any, text: string) => scoped.push(label(event, text)), {
         webContents: a.webContents,
      });
      ctx.ipc.log.on((event: any, text: string) => global.push(label(event, text)));
      await ctx.evaluate(a, () => ipc.log.send("one"));
      await ctx.evaluate(b, () => ipc.log.send("two"));
      await ctx.waitFor(() => global.length === 2);
      await ctx.sleep(100);
      return { scoped, global };
   },

   scopedSendOnce: async (ctx) => {
      const win = await ctx.open();
      const got: unknown[] = [];
      ctx.ipc.log.once((_event: unknown, text: string) => got.push(text), {
         webContents: win.webContents,
      });
      await ctx.evaluate(win, () => {
         ipc.log.send("first");
         ipc.log.send("second");
      });
      await ctx.waitFor(() => got.length > 0);
      await ctx.sleep(200);
      return got;
   },

   scopedDestroyed: async (ctx) => {
      const [gone, staying] = [await ctx.open(), await ctx.open()];
      const target = gone.webContents.ipc;
      const heard: unknown[] = [];
      ctx.ipc.getValue.handle(async () => "gone", { webContents: gone.webContents });
      ctx.ipc.getValue.handle(async () => "staying", { webContents: staying.webContents });
      ctx.ipc.log.on((_event: unknown, text: string) => heard.push(text), {
         webContents: gone.webContents,
      });
      ctx.ipc.log.on((_event: unknown, text: string) => heard.push(text), {
         webContents: staying.webContents,
      });
      const before = target.listenerCount("autoipc:log");

      gone.destroy();
      await ctx.waitFor(() => target.listenerCount("autoipc:log") === 0, "the listener is removed");
      // Electron refuses a second handler, so registering again shows that the first one is gone.
      let handlerRemoved = true;
      try {
         target.handle("autoipc:getValue", () => "again");
         target.removeHandler("autoipc:getValue");
      } catch {
         handlerRemoved = false;
      }
      let error: string | null = null;
      try {
         ctx.ipc.getValue.handle(async () => "late", { webContents: gone.webContents });
      } catch (cause: any) {
         error = String(cause?.message ?? cause);
      }
      const stayed = await ctx.evaluate(staying, () => ipc.getValue.invoke(1));
      await ctx.evaluate(staying, () => ipc.log.send("still"));
      await ctx.waitFor(() => heard.length > 0);
      return { before, handlerRemoved, error, stayed, heard };
   },

   scopedManyRegistrations: async (ctx) => {
      const win = await ctx.open();
      const warnings: string[] = [];
      process.on("warning", (warning: Error) => warnings.push(warning.name));
      // Electron has listeners of its own for this event.
      const baseline = win.webContents.listenerCount("destroyed");
      for (const name of ["getValue", "fail", "missing", "once", "replaced"]) {
         ctx.ipc[name].handle(async () => "x", { webContents: win.webContents });
      }
      for (let i = 0; i < 4; i++) {
         ctx.ipc.log.on(() => {}, { webContents: win.webContents });
         ctx.ipc.optional.once(() => {}, { webContents: win.webContents });
      }
      await ctx.sleep(100);
      return { added: win.webContents.listenerCount("destroyed") - baseline, warnings };
   },

   bind: async (ctx) => {
      const win = await ctx.open();
      await ctx.evaluate(win, () => {
         (window as any).titles = [];
         ipc.titleChanged.on((title: string) => (window as any).titles.push(title));
      });
      const errors: string[] = [];
      let calls = 0;
      const dispose = ctx.ipc.titleChanged.bind(
         win,
         async () => {
            calls++;
            if (calls === 3) {
               throw new Error("provider failed");
            }
            return [`title ${win.webContents.getTitle()}`];
         },
         (error: Error) => errors.push(error.message),
      );
      const setTitle = (title: string) =>
         ctx.evaluate(win, (t: string) => (document.title = t), title);
      const titles = () => ctx.evaluate(win, () => (window as any).titles);
      await setTitle("one");
      await ctx.waitFor(async () => (await titles()).length === 1);
      await setTitle("two");
      await ctx.waitFor(async () => (await titles()).length === 2);
      await setTitle("three");
      await ctx.waitFor(() => errors.length === 1);
      dispose();
      await setTitle("four");
      await ctx.sleep(300);
      return { titles: await titles(), errors, calls };
   },
};

describeElectron("core channels in Electron", "electron-core", scenarios, (group) => {
   it("runs the preload script sandboxed and in an isolated context, and exposes the API", () => {
      expect(group.value("environment")).toStrictEqual({
         env: { sandboxed: true, contextIsolated: true },
         members: [
            "fail",
            "getValue",
            "log",
            "missing",
            "notice",
            "once",
            "optional",
            "replaced",
            "tick",
            "titleChanged",
         ],
         invoke: "function",
      });
   });

   it("has no uncaught errors in the main process", () => {
      expect(group.run().uncaught).toStrictEqual([]);
   });

   describe("invoke", () => {
      it("returns the value of the handler, and passes the real sender frame", () => {
         const { value, seen } = group.value("invokeValue");
         expect(value).toBe("user 7");
         expect(seen).toStrictEqual([
            { url: "app://main/index.html", origin: "app://main", id: 7 },
         ]);
      });

      it("rejects with a plain object which has the fields of the error, and not with an Error", () => {
         expect(group.value("invokeError")).toStrictEqual({
            rejected: true,
            isError: false,
            name: "AppError",
            message: "the app failed",
            code: "E_APP",
            data: { id: 3, tags: ["a", "b"] },
            keys: ["code", "data", "message", "name"],
         });
      });

      it("rejects a call which has no handler", () => {
         const { rejected, message } = group.value("invokeNoHandler");
         expect(rejected).toBe(true);
         expect(message).toContain("No handler registered for 'autoipc:missing'");
      });

      it("answers the first call of handleOnce, and has no handler for the second", () => {
         const { first, second } = group.value("handleOnce");
         expect(first).toBe(42);
         expect(second.message).toContain("No handler registered for 'autoipc:once'");
      });

      it("uses the latest handler, and a stale disposer does not remove it", () => {
         const result = group.value("handlerReplaced");
         expect(result.before).toStrictEqual({ value: "first" });
         expect(result.replaced).toStrictEqual({ value: "second" });
         expect(result.afterStale).toStrictEqual({ value: "second" });
         expect(result.afterOwn.message).toContain("No handler registered for 'autoipc:replaced'");
      });
   });

   describe("send", () => {
      it("passes the rest parameters, and an omitted optional parameter as undefined", () => {
         expect(group.value("sendArguments")).toStrictEqual({
            logged: [["a"], ["b", 1, 2, 3]],
            optional: [
               ["x", "undefined"],
               ["y", 5],
            ],
         });
      });

      it("handles only the first message with once", () => {
         expect(group.value("sendOnce")).toStrictEqual([["first"]]);
      });
   });

   it("removes exactly the listener of a disposer, in the main process and in the page", () => {
      expect(group.value("listenerDisposers")).toStrictEqual({
         main: { kept: ["before", "after"], removed: ["before", "before"] },
         page: { kept: [1, 2], removed: [1], once: [1], onceOff: [] },
         listeners: 1,
      });
   });

   describe("emit", () => {
      it("sends to a window, to a WebContentsView, to WebContents and to a frame", () => {
         const { window, view } = group.value("emitTargets");
         expect(window).toStrictEqual([
            ["to window", "undefined"],
            ["to contents", 2],
            ["to frame", 3],
         ]);
         expect(view).toStrictEqual([["to view", 1]]);
      });

      it("broadcasts to all windows, and filters with broadcastTo", () => {
         const result = group.value("broadcast");
         expect(result.all).toStrictEqual([[1], [1], [1]]);
         expect(result.filtered).toStrictEqual([[1], [1, 2], [1]]);
      });

      it("skips a window which was destroyed", () => {
         const result = group.value("broadcast");
         expect(result.error).toBeNull();
         expect(result.afterDestroy).toStrictEqual([
            [1, 3, 4],
            [1, 2, 3, 4],
         ]);
      });

      it("sends what the provider returns when the trigger fires, and reports a provider which fails", () => {
         const result = group.value("bind");
         expect(result.titles).toStrictEqual(["title one", "title two"]);
         expect(result.errors).toStrictEqual(["provider failed"]);
         // The dispose stops the binding, so the fourth title does not reach the provider.
         expect(result.calls).toBe(3);
      });
   });

   describe("the webContents option", () => {
      it("answers an invoke from the handler of the contents before the global handler", () => {
         const result = group.value("scopedInvoke");
         expect(result.global).toStrictEqual(["global 1", "global 1"]);
         // Only the window whose contents the handler belongs to is answered by it.
         expect(result.withScoped).toStrictEqual(["scoped 2", "global 2"]);
         expect(result.afterDispose).toStrictEqual(["global 3", "global 3"]);
      });

      it("serves a channel with no global handler for its own window only", () => {
         const { a, b } = group.value("scopedInvokeOnly");
         expect(a).toStrictEqual({ value: "only 1" });
         expect(b.message).toContain("No handler registered for 'autoipc:getValue'");
      });

      it("answers one invoke with handleOnce, then the global handler is used", () => {
         expect(group.value("scopedHandleOnce")).toStrictEqual(["scoped once", "global"]);
      });

      it("delivers a send to the listener of the contents, and also to the global listener", () => {
         const { scoped, global } = group.value("scopedSend");
         expect(scoped).toStrictEqual(["a:one"]);
         expect([...global].sort()).toStrictEqual(["a:one", "b:two"]);
      });

      it("hands the first message only to once", () => {
         expect(group.value("scopedSendOnce")).toStrictEqual(["first"]);
      });

      it("removes the registrations when the window is destroyed, and keeps the others", () => {
         const result = group.value("scopedDestroyed");
         expect(result.before).toBe(1);
         expect(result.handlerRemoved).toBe(true);
         expect(result.stayed).toBe("staying");
         expect(result.heard).toStrictEqual(["still"]);
      });

      it("refuses contents which are already destroyed", () => {
         expect(group.value("scopedDestroyed").error).toBe("Object has been destroyed");
      });

      it("uses one destroyed listener for any number of registrations", () => {
         const { added, warnings } = group.value("scopedManyRegistrations");
         expect(added).toBe(1);
         expect(warnings).toStrictEqual([]);
      });
   });

   it("type-checks the generated files of the fixture", async () => {
      const project = await runFixture("electron-core");
      try {
         expect(await project.typecheck()).toBe("");
      } finally {
         await project.cleanup();
      }
   }, 120_000);
});
