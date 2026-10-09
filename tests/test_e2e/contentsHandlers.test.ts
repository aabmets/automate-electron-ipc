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

// T34: `ipc.<name>.on` / `handle` (and `once` and `handleOnce`) take `{ webContents }` and register
// on `webContents.ipc` instead of the global `ipcMain`. The fake contents below follow the dispatch
// of Electron: a message goes to `webContents.ipc` first and then to `ipcMain`. An `invoke` goes
// to the first of the two that has a handler, and a `send` goes to the listeners of both.

import { EventEmitter } from "node:events";
import fsp from "node:fs/promises";
import path from "node:path";
import v8 from "node:v8";
import { runInNewContext } from "node:vm";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { createFakeElectron, loadGenerated } from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   await project?.cleanup();
   project = undefined;
});

/** An `IpcMain` stand-in: real listeners, and handlers which refuse a second one like Electron's. */
function createFakeIpc() {
   const emitter = new EventEmitter().setMaxListeners(0);
   const handlers = new Map<string, (...args: any[]) => any>();
   return {
      emitter,
      handlers,
      on: vi.fn((channel: string, listener: (...args: any[]) => void) =>
         emitter.on(channel, listener),
      ),
      off: vi.fn((channel: string, listener: (...args: any[]) => void) =>
         emitter.off(channel, listener),
      ),
      handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
         if (handlers.has(channel)) {
            throw new Error(`Attempted to register a second handler for '${channel}'`);
         }
         handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
   };
}

type FakeIpc = ReturnType<typeof createFakeIpc>;

let lastContentsId = 0;

function createContents() {
   const contents = Object.assign(new EventEmitter(), {
      id: ++lastContentsId,
      ipc: createFakeIpc(),
      destroyed: false,
      isDestroyed: () => contents.destroyed,
      destroy() {
         contents.destroyed = true;
         contents.emit("destroyed");
      },
   });
   return contents;
}

type Contents = ReturnType<typeof createContents>;

/** The event of a call from the main frame of the contents. */
const eventFrom = (sender: Contents, origin = "app://.") => ({
   sender,
   senderFrame: { origin },
});

async function loadMain(fixture = "all-kinds") {
   project = await runFixture(fixture);
   const globalIpc = createFakeIpc();
   const electron = { ...createFakeElectron(), ipcMain: globalIpc };
   // The fixture of the streams imports a validator, which the stream never calls here.
   const generated = loadGenerated(project.generated["main.ts"], {
      electron,
      "./validators": { __esModule: true, countArgs: {} },
   });
   /** Delivers an `invoke` of the page the way Electron does: the first target with a handler answers. */
   const invoke = async (contents: Contents, channel: string, ...args: unknown[]) => {
      const target: FakeIpc | undefined = [contents.ipc, globalIpc].find((ipc) =>
         ipc.handlers.has(`autoipc:${channel}`),
      );
      if (!target) {
         throw new Error(`No handler registered for '${channel}'`);
      }
      return await target.handlers.get(`autoipc:${channel}`)?.(eventFrom(contents), ...args);
   };
   /** Delivers a `send` of the page: the listeners of the contents, then the global ones. */
   const send = (contents: Contents, channel: string, ...args: unknown[]) => {
      const event = eventFrom(contents);
      contents.ipc.emitter.emit(`autoipc:${channel}`, event, ...args);
      globalIpc.emitter.emit(`autoipc:${channel}`, event, ...args);
   };
   return { generated, ipc: generated.ipc, globalIpc, invoke, send };
}

const ok = (value: unknown) => ({ ok: true, value });

describe("the webContents option of listeners and handlers", () => {
   it("registers on the ipc of the contents, and leaves the global ipcMain alone", async () => {
      const { ipc, globalIpc } = await loadMain();
      const contents = createContents();

      ipc.getUser.handle(async () => "scoped", { webContents: contents });
      ipc.logLine.on(vi.fn(), { webContents: contents });

      expect(contents.ipc.handle).toHaveBeenCalledWith("autoipc:getUser", expect.any(Function));
      expect(contents.ipc.on).toHaveBeenCalledWith("autoipc:logLine", expect.any(Function));
      expect(globalIpc.handle).not.toHaveBeenCalled();
      expect(globalIpc.removeHandler).not.toHaveBeenCalled();
      expect(globalIpc.on).not.toHaveBeenCalled();
   });

   it("registers on the global ipcMain without the option, or with the option left empty", async () => {
      const { ipc, globalIpc } = await loadMain();

      ipc.getUser.handle(async () => "a");
      ipc.logLine.on(vi.fn(), {});
      ipc.logLine.on(vi.fn(), { webContents: undefined });

      expect(globalIpc.handle).toHaveBeenCalledTimes(1);
      expect(globalIpc.on).toHaveBeenCalledTimes(2);
   });

   it("answers an invoke from the handler of the contents, before the global handler", async () => {
      const { ipc, invoke } = await loadMain();
      const first = createContents();
      const second = createContents();
      ipc.getUser.handle(async (_event: unknown, id: number) => `global ${id}`);
      ipc.getUser.handle(async (_event: unknown, id: number) => `first ${id}`, {
         webContents: first,
      });

      expect(await invoke(first, "getUser", 1)).toStrictEqual(ok("first 1"));
      // A page which has no handler of its own is served by the global one.
      expect(await invoke(second, "getUser", 2)).toStrictEqual(ok("global 2"));
   });

   it("lets a handler of the contents serve a channel which has no global handler", async () => {
      const { ipc, invoke } = await loadMain();
      const contents = createContents();
      const other = createContents();
      ipc.getUser.handle(async () => "mine", { webContents: contents });

      expect(await invoke(contents, "getUser", 1)).toStrictEqual(ok("mine"));
      await expect(invoke(other, "getUser", 1)).rejects.toThrow("No handler registered");
   });

   it("delivers a send to the listeners of the contents and to the global ones", async () => {
      const { ipc, send } = await loadMain();
      const contents = createContents();
      const other = createContents();
      const scoped = vi.fn();
      const global = vi.fn();
      ipc.logLine.on(scoped, { webContents: contents });
      ipc.logLine.on(global);

      send(contents, "logLine", "from contents");
      send(other, "logLine", "from other");

      expect(scoped).toHaveBeenCalledTimes(1);
      expect(scoped).toHaveBeenCalledWith(
         expect.objectContaining({ sender: contents }),
         "from contents",
      );
      // Electron also hands the message to ipcMain, so a global listener sees both pages.
      expect(global.mock.calls.map(([, text]) => text)).toStrictEqual([
         "from contents",
         "from other",
      ]);
   });

   it("keeps the registries of the global target and of each contents apart", async () => {
      const { ipc, invoke } = await loadMain();
      const first = createContents();
      const second = createContents();
      const disposeGlobal = ipc.getUser.handle(async () => "global");
      const disposeFirst = ipc.getUser.handle(async () => "first", { webContents: first });
      ipc.getUser.handle(async () => "second", { webContents: second });

      disposeFirst();

      // Disposing the handler of one page removes only that one.
      await expect(invoke(first, "getUser", 1)).resolves.toStrictEqual(ok("global"));
      expect(await invoke(second, "getUser", 1)).toStrictEqual(ok("second"));
      disposeGlobal();
      expect(await invoke(second, "getUser", 1)).toStrictEqual(ok("second"));
      await expect(invoke(first, "getUser", 1)).rejects.toThrow("No handler registered");
   });

   describe("handlers", () => {
      it("replaces the handler of the same contents when it is registered again", async () => {
         const { ipc, invoke } = await loadMain();
         const contents = createContents();
         ipc.getUser.handle(async () => "old", { webContents: contents });

         expect(() =>
            ipc.getUser.handle(async () => "new", { webContents: contents }),
         ).not.toThrow();

         expect(contents.ipc.handlers.size).toBe(1);
         expect(await invoke(contents, "getUser", 1)).toStrictEqual(ok("new"));
      });

      it("makes the disposer of a replaced handler do nothing, so it cannot remove the new one", async () => {
         const { ipc, invoke } = await loadMain();
         const contents = createContents();
         const disposeOld = ipc.getUser.handle(async () => "old", { webContents: contents });
         const disposeNew = ipc.getUser.handle(async () => "new", { webContents: contents });

         disposeOld();
         expect(await invoke(contents, "getUser", 1)).toStrictEqual(ok("new"));
         disposeNew();
         expect(contents.ipc.handlers.size).toBe(0);
         // Calling a disposer twice is harmless.
         expect(() => disposeNew()).not.toThrow();
         expect(contents.ipc.removeHandler).toHaveBeenCalledTimes(3);
      });

      it("does not let a handler of another page replace or remove the handler of a page", async () => {
         const { ipc, invoke } = await loadMain();
         const first = createContents();
         const second = createContents();
         ipc.getUser.handle(async () => "first", { webContents: first });
         const disposeSecond = ipc.getUser.handle(async () => "second", { webContents: second });

         disposeSecond();

         expect(await invoke(first, "getUser", 1)).toStrictEqual(ok("first"));
      });

      it("handleOnce answers one invoke, then the channel is free", async () => {
         const { ipc, invoke } = await loadMain();
         const contents = createContents();
         ipc.getUser.handleOnce(async () => "once", { webContents: contents });

         expect(await invoke(contents, "getUser", 1)).toStrictEqual(ok("once"));
         await expect(invoke(contents, "getUser", 1)).rejects.toThrow("No handler registered");
         expect(contents.ipc.handlers.size).toBe(0);
      });

      it("handleOnce can be disposed before the invoke", async () => {
         const { ipc, invoke } = await loadMain();
         const contents = createContents();
         const dispose = ipc.getUser.handleOnce(async () => "once", { webContents: contents });

         dispose();

         await expect(invoke(contents, "getUser", 1)).rejects.toThrow("No handler registered");
      });
   });

   describe("listeners", () => {
      it("returns a disposer which removes only that listener", async () => {
         const { ipc, send } = await loadMain();
         const contents = createContents();
         const kept = vi.fn();
         const removed = vi.fn();
         ipc.logLine.on(kept, { webContents: contents });
         const dispose = ipc.logLine.on(removed, { webContents: contents });

         send(contents, "logLine", "a");
         dispose();
         send(contents, "logLine", "b");

         expect(removed).toHaveBeenCalledTimes(1);
         expect(kept).toHaveBeenCalledTimes(2);
         expect(contents.ipc.emitter.listenerCount("autoipc:logLine")).toBe(1);
      });

      it("once delivers the first message only", async () => {
         const { ipc, send } = await loadMain();
         const contents = createContents();
         const callback = vi.fn();
         ipc.logLine.once(callback, { webContents: contents });

         send(contents, "logLine", "a");
         send(contents, "logLine", "b");

         expect(callback).toHaveBeenCalledTimes(1);
         expect(contents.ipc.emitter.listenerCount("autoipc:logLine")).toBe(0);
      });
   });

   describe("when the contents are destroyed", () => {
      it("removes the handlers and the listeners from the ipc of the contents", async () => {
         const { ipc, send, invoke } = await loadMain();
         const contents = createContents();
         const listener = vi.fn();
         ipc.getUser.handle(async () => "mine", { webContents: contents });
         ipc.logLine.on(listener, { webContents: contents });

         contents.destroy();

         expect(contents.ipc.removeHandler).toHaveBeenCalledWith("autoipc:getUser");
         expect(contents.ipc.off).toHaveBeenCalledWith("autoipc:logLine", expect.any(Function));
         expect(contents.ipc.handlers.size).toBe(0);
         expect(contents.ipc.emitter.listenerCount("autoipc:logLine")).toBe(0);
         send(contents, "logLine", "late");
         expect(listener).not.toHaveBeenCalled();
         await expect(invoke(contents, "getUser", 1)).rejects.toThrow("No handler registered");
      });

      it("leaves the registrations of other contents and the global ones alone", async () => {
         const { ipc, send, invoke } = await loadMain();
         const gone = createContents();
         const staying = createContents();
         const globalListener = vi.fn();
         ipc.getUser.handle(async () => "gone", { webContents: gone });
         ipc.getUser.handle(async () => "staying", { webContents: staying });
         ipc.logLine.on(globalListener);

         gone.destroy();

         expect(await invoke(staying, "getUser", 1)).toStrictEqual(ok("staying"));
         send(staying, "logLine", "still there");
         expect(globalListener).toHaveBeenCalledTimes(1);
      });

      it("makes the disposers harmless afterwards", async () => {
         const { ipc } = await loadMain();
         const contents = createContents();
         const disposeHandler = ipc.getUser.handle(async () => "mine", { webContents: contents });
         const disposeListener = ipc.logLine.on(vi.fn(), { webContents: contents });

         contents.destroy();

         expect(() => disposeHandler()).not.toThrow();
         expect(() => disposeListener()).not.toThrow();
      });

      it("does not touch the destroyed event for a registration which was disposed", async () => {
         const { ipc } = await loadMain();
         const contents = createContents();
         const dispose = ipc.logLine.on(vi.fn(), { webContents: contents });
         dispose();
         contents.ipc.off.mockClear();

         contents.destroy();

         expect(contents.ipc.off).not.toHaveBeenCalled();
      });

      it("uses one destroyed listener for all registrations of the contents", async () => {
         const { ipc } = await loadMain();
         const contents = createContents();

         for (let i = 0; i < 25; i++) {
            ipc.logLine.on(vi.fn(), { webContents: contents });
            ipc.logLine.once(vi.fn(), { webContents: contents });
         }
         ipc.getUser.handle(async () => "a", { webContents: contents });
         ipc.getTime.handleOnce(async () => 1, { webContents: contents });

         // Node warns when there are more than ten listeners of one event.
         expect(contents.listenerCount("destroyed")).toBe(1);
         contents.destroy();
         expect(contents.ipc.emitter.listenerCount("autoipc:logLine")).toBe(0);
         expect(contents.ipc.handlers.size).toBe(0);
      });

      describe("a handler that another one replaced", () => {
         /** Whether the callback of a handler which `count` newer ones replaced can be collected. */
         async function isReleased(options: (contents: Contents) => object): Promise<boolean> {
            v8.setFlagsFromString("--expose-gc");
            const gc = runInNewContext("gc") as () => void;
            const { ipc, globalIpc } = await loadMain();
            const contents = createContents();
            let first: (() => Promise<string>) | undefined = async () => "first";
            const released = new WeakRef(first);
            ipc.getUser.handle(first, options(contents));
            first = undefined;
            for (let i = 0; i < 5; i++) {
               ipc.getUser.handle(async () => `newer ${i}`, options(contents));
            }
            // The calls that the mocks of the fakes record would keep the callback alive too.
            for (const fake of [globalIpc, contents.ipc]) {
               fake.handle.mockClear();
               fake.removeHandler.mockClear();
            }
            for (let i = 0; i < 10 && released.deref(); i++) {
               // biome-ignore lint/performance/noAwaitInLoops: each collection waits for the last one
               await new Promise((resolve) => setImmediate(resolve));
               gc();
            }
            return released.deref() === undefined;
         }

         // A control, which shows that the check can see a callback being collected.
         it("is released when the handler is global", async () => {
            expect(await isReleased(() => ({}))).toBe(true);
         });

         // T87: each registration on the contents keeps its remover in the record of the contents
         // until the contents are destroyed, and the remover holds the replaced callback.
         it.fails("is released when the handler is registered on the contents", async () => {
            expect(await isReleased((contents) => ({ webContents: contents }))).toBe(true);
         });
      });

      it("throws for contents which are already destroyed, and registers nothing", async () => {
         const { ipc, globalIpc } = await loadMain();
         const contents = createContents();
         contents.destroy();

         expect(() => ipc.getUser.handle(async () => "x", { webContents: contents })).toThrow(
            new TypeError("Object has been destroyed"),
         );
         expect(() => ipc.logLine.on(vi.fn(), { webContents: contents })).toThrow(TypeError);
         expect(contents.ipc.handle).not.toHaveBeenCalled();
         expect(contents.ipc.on).not.toHaveBeenCalled();
         expect(globalIpc.handle).not.toHaveBeenCalled();
      });
   });

   describe("sender validation", () => {
      it("checks the origin of the frame for a handler of the contents", async () => {
         const { ipc, generated, invoke } = await loadMain("sender-validation");
         const contents = createContents();
         const onRejected = vi.fn();
         generated.configureIpc({ onRejected });
         const callback = vi.fn(async () => "secret");
         ipc.getSecret.handle(callback, { webContents: contents });
         const handler = contents.ipc.handlers.get("autoipc:getSecret");

         const allowed = await handler?.(eventFrom(contents, "app://."), 1);
         const rejected = await handler?.(eventFrom(contents, "https://evil.example"), 1);

         expect(allowed).toStrictEqual(ok("secret"));
         expect(rejected).toMatchObject({ ok: false, error: { code: "IPC_FORBIDDEN" } });
         expect(callback).toHaveBeenCalledTimes(1);
         expect(onRejected).toHaveBeenCalledTimes(1);
         // The global dispatch finds the same handler for this page.
         await expect(invoke(contents, "getSecret", 1)).resolves.toStrictEqual(ok("secret"));
      });

      it("drops a send from a frame which is not allowed, for a listener of the contents", async () => {
         const { ipc, send } = await loadMain("sender-validation");
         const contents = createContents();
         const callback = vi.fn();
         ipc.logLine.on(callback, { webContents: contents });

         contents.ipc.emitter.emit(
            "autoipc:logLine",
            eventFrom(contents, "https://evil.example"),
            "x",
         );
         send(contents, "logLine", "y");

         expect(callback).toHaveBeenCalledTimes(1);
         expect(callback).toHaveBeenCalledWith(expect.anything(), "y");
      });
   });

   it("takes the option on the handler of a stream channel too", async () => {
      const { ipc, globalIpc } = await loadMain("stream-channels");
      const contents = createContents();

      const dispose = ipc.exportRows.handle(vi.fn(), { webContents: contents });

      expect(contents.ipc.handle).toHaveBeenCalledWith("autoipc:exportRows", expect.any(Function));
      expect(globalIpc.handle).not.toHaveBeenCalled();
      dispose();
      expect(contents.ipc.removeHandler).toHaveBeenCalledWith("autoipc:exportRows");
      expect(contents.ipc.handlers.size).toBe(0);
   });

   it("generates none of it for a schema which has no channel from a renderer to the main process", async () => {
      project = await runFixture("port-only");
      const main = project.generated["main.ts"];

      expect(main).not.toContain("IpcListenOptions");
      expect(main).not.toContain("resolveIpcTarget");
   });
});

describe("fixture contents-handlers, the types of the webContents option", () => {
   it("accepts the option on handle, handleOnce, on, once and the handle of a stream", async () => {
      project = await runFixture("contents-handlers");

      expect(project.generated["main.ts"]).toContain("export interface IpcListenOptions {");
      expect(await project.typecheck()).toBe("");
   });

   it("rejects a value which is not WebContents, and an option which does not exist", async () => {
      project = await runFixture("contents-handlers");
      const usage = path.join(project.dir, project.ipcDataDir, "schema-usage.ts");
      const text = await fsp.readFile(usage, "utf8");
      const valid = "disposers.push(ipc.log.on(() => undefined, {}));";
      expect(text).toContain(valid);

      await fsp.writeFile(
         usage,
         text.replace(
            valid,
            'disposers.push(ipc.log.on(() => undefined, { webContents: "main" }));',
         ),
      );
      expect(await project.typecheck()).toContain("TS2322");

      await fsp.writeFile(
         usage,
         text.replace(valid, "disposers.push(ipc.log.on(() => undefined, { window: contents }));"),
      );
      expect(await project.typecheck()).toContain("TS2353");
   }, 60_000);
});
