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

import { EventEmitter } from "node:events";
import fsp from "node:fs/promises";
import path from "node:path";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import {
   callablePaths,
   createFakeElectron,
   createFakePreloadElectron,
   loadGenerated,
   windowIpcPaths,
} from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   await project?.cleanup();
   project = undefined;
});

/** The paths of the API that each scope of the fixture `scoped-windows` gets. */
const SURFACES: Record<string, string[]> = {
   default: ["getVersion.invoke", "log.send"],
   settings: [
      "getSettings.invoke",
      "getVersion.invoke",
      "log.send",
      "notify.send",
      "saveSettings.invoke",
      "themeChanged.on",
      "themeChanged.once",
      "vault.invoke",
   ],
   editor: [
      "chat.onClose",
      "chat.onConnection",
      "chat.onOverflow",
      "chat.onReady",
      "chat.on",
      "chat.send",
      "exportRows.stream",
      "getVersion.invoke",
      "hasUnsavedChanges.handle",
      "log.send",
      "notify.send",
      "openFile.invoke",
   ].sort(),
};

const FILES: Record<string, { preload: string; types: string }> = {
   default: { preload: "preload.ts", types: "window.d.ts" },
   settings: { preload: "preload.settings.ts", types: "window.settings.d.ts" },
   editor: { preload: "preload.editor.ts", types: "window.editor.d.ts" },
};

describe("fixture scoped-windows, the files of the scopes", () => {
   it("writes a preload script and a .d.ts file for each scope, next to the default ones", async () => {
      project = await runFixture("scoped-windows");
      const names = await fsp.readdir(path.join(project.dir, project.ipcDataDir));

      expect(names.filter((name) => /^(preload|window)/.test(name)).sort()).toStrictEqual([
         "preload.editor.ts",
         "preload.settings.ts",
         "preload.ts",
         "window.d.ts",
         "window.editor.d.ts",
         "window.settings.d.ts",
      ]);
   });

   it.each(Object.keys(SURFACES))(
      "exposes only the channels of the scope '%s', and declares the same ones",
      async (scope) => {
         project = await runFixture("scoped-windows");
         const fake = createFakePreloadElectron();
         loadGenerated(await project.read(FILES[scope].preload), { electron: fake.electron });

         const exposed = callablePaths(fake.exposed.ipc);
         expect(exposed).toStrictEqual([...SURFACES[scope]].sort());
         expect(windowIpcPaths(await project.read(FILES[scope].types))).toStrictEqual(exposed);
      },
   );

   it("generates the preload script of a scope like any other, with the channels of the scope only", async () => {
      project = await runFixture("scoped-windows");
      const settings = await project.read("preload.settings.ts");

      expect(settings).toContain("export function expose(key = 'ipc'): void {");
      expect(settings).toContain("ipcRenderer.invoke('autoipc:getSettings', ...args)");
      expect(settings).not.toContain("openFile");
   });

   it.each(Object.keys(SURFACES))(
      "generates files that type-check for the scope '%s'",
      async (scope) => {
         project = await runFixture("scoped-windows");

         expect(await project.typecheckScope(scope)).toBe("");
      },
   );

   it("imports only the types that the channels of a scope use", async () => {
      project = await runFixture("scoped-windows");

      expect(await project.read("window.settings.d.ts")).toContain(
         'import type { Settings } from "./schema";',
      );
      expect(await project.read("window.settings.d.ts")).not.toContain("Document");
      expect(await project.read("window.editor.d.ts")).toContain(
         'import type { Document } from "./schema";',
      );
      expect(await project.read("window.editor.d.ts")).not.toContain("Settings");
      expect(project.generated["window.d.ts"]).not.toContain("import");
   });

   it("gives the main bindings every channel, in the one file", async () => {
      project = await runFixture("scoped-windows");
      const { ipc } = loadGenerated(project.generated["main.ts"], {
         electron: createFakeElectron(),
      });

      expect(Object.keys(ipc).sort()).toStrictEqual([
         "chat",
         "exportRows",
         "getSettings",
         "getVersion",
         "hasUnsavedChanges",
         "log",
         "notify",
         "openFile",
         "saveSettings",
         "themeChanged",
         "vault",
      ]);
   });
});

/** A WebContents stand-in: an emitter with an ID, which can be destroyed. */
function createContents(id: number) {
   const contents = Object.assign(new EventEmitter(), {
      id,
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

/** The event of a call from a frame of the contents. */
const callFrom = (sender: Contents | null, origin: string | null = "app://.") => ({
   sender,
   senderFrame: origin === null ? null : { origin },
});

/** Loads the main bindings with an `ipcMain` which keeps the listeners and the handlers. */
async function loadMain(fixture = "scoped-windows") {
   project = await runFixture(fixture);
   const handlers = new Map<string, (...args: any[]) => any>();
   const emitter = new EventEmitter();
   const electron = createFakeElectron();
   Object.assign(electron.ipcMain, {
      on: (channel: string, listener: (...args: any[]) => void) => emitter.on(channel, listener),
      off: (channel: string, listener: (...args: any[]) => void) => emitter.off(channel, listener),
      handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler),
      removeHandler: (channel: string) => handlers.delete(channel),
   });
   const generated = loadGenerated(project.generated["main.ts"], { electron });
   /** Calls the handler of an invoke channel, and returns its envelope. */
   const call = (channel: string, event: unknown, ...args: unknown[]) =>
      handlers.get(`autoipc:${channel}`)?.(event, ...args);
   return { generated, ipc: generated.ipc, emitter, call };
}

const forbidden = (channel: string) => ({
   ok: false,
   error: {
      name: "IpcForbiddenError",
      message: expect.stringContaining(`'${channel}'`),
      code: "IPC_FORBIDDEN",
   },
});

describe("registerScope, and the channels with scopes in the main process", () => {
   it("declares the scopes of the schema as the type IpcScope, and the function registerScope", async () => {
      const { generated } = await loadMain();

      expect(generated.registerScope).toBeTypeOf("function");
      expect(project?.generated["main.ts"]).toContain(
         "export type IpcScope = 'editor' | 'settings';",
      );
   });

   it("leaves the registry out of a schema without scopes", async () => {
      project = await runFixture("sender-validation");
      const main = project.generated["main.ts"];

      expect(main).not.toMatch(/registerScope|scopeRegistry|IpcScope/);
      expect(main).toContain("allowedOrigins?: string[]): boolean {");
   });

   it("lets every window call a channel without scopes, also one that is in no scope", async () => {
      const { ipc, call, emitter } = await loadMain();
      const log = vi.fn();
      ipc.getVersion.handle(async () => "1.0");
      ipc.log.on(log);

      // Not even a frame: nothing applies to these channels.
      await expect(call("getVersion", {})).resolves.toStrictEqual({ ok: true, value: "1.0" });
      emitter.emit("autoipc:log", {}, "text");
      expect(log).toHaveBeenCalledOnce();
   });

   it("rejects a call to a channel with scopes from contents that are in no scope", async () => {
      const { ipc, call } = await loadMain();
      const handler = vi.fn(async () => ({ theme: "dark" }));
      ipc.getSettings.handle(handler);

      await expect(call("getSettings", callFrom(createContents(1)))).resolves.toStrictEqual(
         forbidden("getSettings"),
      );
      expect(handler).not.toHaveBeenCalled();
   });

   it("lets contents call the channels of the scope that they are registered in", async () => {
      const { generated, ipc, call } = await loadMain();
      const settings = createContents(1);
      const editor = createContents(2);
      generated.registerScope(settings, "settings");
      generated.registerScope(editor, "editor");
      ipc.getSettings.handle(async () => ({ theme: "dark" }));
      ipc.openFile.handle(async (_event: unknown, path: string) => ({ path, text: "" }));

      await expect(call("getSettings", callFrom(settings))).resolves.toStrictEqual({
         ok: true,
         value: { theme: "dark" },
      });
      await expect(call("openFile", callFrom(editor), "a.txt")).resolves.toStrictEqual({
         ok: true,
         value: { path: "a.txt", text: "" },
      });
   });

   it("rejects the channels of another scope, and does not run their handlers", async () => {
      const { generated, ipc, call } = await loadMain();
      const settings = createContents(1);
      const editor = createContents(2);
      generated.registerScope(settings, "settings");
      generated.registerScope(editor, "editor");
      const getSettings = vi.fn(async () => ({ theme: "dark" }));
      const openFile = vi.fn(async () => ({ path: "", text: "" }));
      ipc.getSettings.handle(getSettings);
      ipc.openFile.handle(openFile);

      await expect(call("getSettings", callFrom(editor))).resolves.toStrictEqual(
         forbidden("getSettings"),
      );
      await expect(call("openFile", callFrom(settings), "a.txt")).resolves.toStrictEqual(
         forbidden("openFile"),
      );
      expect(getSettings).not.toHaveBeenCalled();
      expect(openFile).not.toHaveBeenCalled();
   });

   it("lets the contents of each scope in the list call a channel of several scopes, and drops the sends of others", async () => {
      const { generated, ipc, emitter } = await loadMain();
      const settings = createContents(1);
      const editor = createContents(2);
      const other = createContents(3);
      generated.registerScope(settings, "settings");
      generated.registerScope(editor, "editor");
      const notify = vi.fn();
      ipc.notify.on(notify);

      emitter.emit("autoipc:notify", callFrom(settings), "from settings");
      emitter.emit("autoipc:notify", callFrom(editor), "from editor");
      emitter.emit("autoipc:notify", callFrom(other), "from nobody");

      expect(notify.mock.calls.map((args) => args[1])).toStrictEqual([
         "from settings",
         "from editor",
      ]);
   });

   it("drops a send from contents of another scope, and tells onRejected", async () => {
      const { generated, ipc, emitter } = await loadMain();
      const editor = createContents(2);
      generated.registerScope(editor, "editor");
      const onRejected = vi.fn();
      generated.configureIpc({ onRejected });
      const notify = vi.fn();
      ipc.notify.on(notify);
      const stray = createContents(5);

      expect(() => emitter.emit("autoipc:notify", callFrom(stray), "text")).not.toThrow();

      expect(notify).not.toHaveBeenCalled();
      expect(onRejected).toHaveBeenCalledOnce();
      expect(onRejected.mock.calls[0][1]).toBe("notify");
   });

   it("tells the contents apart by their ID", async () => {
      const { generated, ipc, call } = await loadMain();
      generated.registerScope(createContents(1), "settings");
      ipc.getSettings.handle(async () => ({ theme: "dark" }));

      await expect(call("getSettings", callFrom(createContents(1)))).resolves.toMatchObject({
         ok: true,
      });
      await expect(call("getSettings", callFrom(createContents(2)))).resolves.toStrictEqual(
         forbidden("getSettings"),
      );
   });

   it("rejects a call without a frame, also from registered contents", async () => {
      const { generated, ipc, call } = await loadMain();
      const settings = createContents(1);
      generated.registerScope(settings, "settings");
      ipc.getSettings.handle(async () => ({ theme: "dark" }));

      await expect(call("getSettings", callFrom(settings, null))).resolves.toStrictEqual(
         forbidden("getSettings"),
      );
   });

   it("rejects a call without a sender, as a call of unknown contents", async () => {
      const { generated, ipc, call } = await loadMain();
      generated.registerScope(createContents(1), "settings");
      ipc.getSettings.handle(async () => ({ theme: "dark" }));

      await expect(call("getSettings", callFrom(null))).resolves.toStrictEqual(
         forbidden("getSettings"),
      );
   });

   it("checks the origin as well as the scope", async () => {
      const { generated, ipc, call } = await loadMain();
      const settings = createContents(1);
      const editor = createContents(2);
      generated.registerScope(settings, "settings");
      generated.registerScope(editor, "editor");
      ipc.vault.handle(async () => "secret");

      await expect(call("vault", callFrom(settings))).resolves.toStrictEqual({
         ok: true,
         value: "secret",
      });
      await expect(call("vault", callFrom(settings, "https://example.com"))).resolves.toStrictEqual(
         forbidden("vault"),
      );
      await expect(call("vault", callFrom(editor))).resolves.toStrictEqual(forbidden("vault"));
   });

   it("asks validateSender only for the calls that are in the scope", async () => {
      const { generated, ipc, call } = await loadMain();
      const settings = createContents(1);
      const editor = createContents(2);
      generated.registerScope(settings, "settings");
      generated.registerScope(editor, "editor");
      const validateSender = vi.fn(() => true);
      generated.configureIpc({ validateSender });
      ipc.getSettings.handle(async () => ({ theme: "dark" }));

      await call("getSettings", callFrom(editor));
      expect(validateSender).not.toHaveBeenCalled();

      await call("getSettings", callFrom(settings));
      expect(validateSender).toHaveBeenCalledOnce();
      expect(validateSender.mock.calls[0][1]).toBe("getSettings");
   });

   it("lets validateSender reject a call that is in the scope", async () => {
      const { generated, ipc, call } = await loadMain();
      const settings = createContents(1);
      generated.registerScope(settings, "settings");
      generated.configureIpc({ validateSender: () => false });
      ipc.getSettings.handle(async () => ({ theme: "dark" }));

      await expect(call("getSettings", callFrom(settings))).resolves.toStrictEqual(
         forbidden("getSettings"),
      );
   });

   describe("the registration", () => {
      it("is removed by the function that registerScope returns", async () => {
         const { generated, ipc, call } = await loadMain();
         const settings = createContents(1);
         const dispose = generated.registerScope(settings, "settings");
         ipc.getSettings.handle(async () => ({ theme: "dark" }));
         await expect(call("getSettings", callFrom(settings))).resolves.toMatchObject({ ok: true });

         dispose();

         await expect(call("getSettings", callFrom(settings))).resolves.toStrictEqual(
            forbidden("getSettings"),
         );
         expect(settings.listenerCount("destroyed")).toBe(0);
      });

      it("is replaced when the contents are registered again, and the old disposer does nothing", async () => {
         const { generated, ipc, call } = await loadMain();
         const contents = createContents(1);
         const disposeFirst = generated.registerScope(contents, "settings");
         generated.registerScope(contents, "editor");
         ipc.getSettings.handle(async () => ({ theme: "dark" }));
         ipc.openFile.handle(async () => ({ path: "", text: "" }));

         disposeFirst();

         await expect(call("getSettings", callFrom(contents))).resolves.toStrictEqual(
            forbidden("getSettings"),
         );
         await expect(call("openFile", callFrom(contents), "a")).resolves.toMatchObject({
            ok: true,
         });
         expect(contents.listenerCount("destroyed")).toBe(1);
      });

      it("is removed when the contents are destroyed", async () => {
         const { generated, ipc, call } = await loadMain();
         const contents = createContents(1);
         generated.registerScope(contents, "settings");
         ipc.getSettings.handle(async () => ({ theme: "dark" }));

         contents.destroy();

         expect(contents.listenerCount("destroyed")).toBe(0);
         await expect(call("getSettings", callFrom(contents))).resolves.toStrictEqual(
            forbidden("getSettings"),
         );
      });

      it("takes the contents of a window or a view", async () => {
         const { generated, ipc, call } = await loadMain();
         const window = { webContents: createContents(1) };
         const view = { webContents: createContents(2) };
         generated.registerScope(window, "settings");
         generated.registerScope(view, "settings");
         ipc.getSettings.handle(async () => ({ theme: "dark" }));

         await expect(call("getSettings", callFrom(window.webContents))).resolves.toMatchObject({
            ok: true,
         });
         await expect(call("getSettings", callFrom(view.webContents))).resolves.toMatchObject({
            ok: true,
         });
      });

      it("throws for a scope that the schema does not declare, and registers nothing", async () => {
         const { generated } = await loadMain();
         const contents = createContents(1);

         expect(() => generated.registerScope(contents, "admin")).toThrowError(
            "The scope 'admin' is not declared in the schema. Use one of: editor, settings",
         );
         expect(contents.listenerCount("destroyed")).toBe(0);
      });

      it("throws for contents that are destroyed already", async () => {
         const { generated } = await loadMain();
         const contents = createContents(1);
         contents.destroyed = true;

         expect(() => generated.registerScope(contents, "settings")).toThrowError(
            "Object has been destroyed",
         );
         expect(contents.listenerCount("destroyed")).toBe(0);
      });

      it("does not pick up a name of Object.prototype as a registration", async () => {
         const { ipc, call } = await loadMain();
         ipc.getSettings.handle(async () => ({ theme: "dark" }));

         // The contents have an ID that is the name of a property of every object.
         const event = callFrom({ id: "constructor" } as unknown as Contents);

         await expect(call("getSettings", event)).resolves.toStrictEqual(forbidden("getSettings"));
      });
   });
});

describe("a schema where the scopes only name channels that the main process does not guard", () => {
   it("still exports registerScope, with the guard of the sender unchanged", async () => {
      project = await runFixture("scoped-emit-only");
      const main = project.generated["main.ts"];

      expect(main).toContain("export function registerScope(");
      expect(main).not.toContain("scopes?: readonly IpcScope[]");
      expect(await project.typecheckScope("hud")).toBe("");
   });
});
