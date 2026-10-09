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

import {
   callFrom,
   createContents,
   disposeScopesFixture,
   forbidden,
   loadMain,
} from "@testutils/e2e/scopes-main-utils.js";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   await disposeScopesFixture();
   await project?.cleanup();
   project = undefined;
});

describe("registerScope, and the channels with scopes in the main process", () => {
   it("declares the scopes of the schema as the type IpcScope, and the function registerScope", async () => {
      const { generated, project: loaded } = await loadMain();

      expect(generated.registerScope).toBeTypeOf("function");
      expect(loaded.generated["main.ts"]).toContain(
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
});
