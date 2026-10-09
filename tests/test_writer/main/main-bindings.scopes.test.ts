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

import fsp from "node:fs/promises";
import { dedent } from "@testutils/text-utils.js";
import mocks from "@testutils/writer/shared-mocks.js";
import shared from "@testutils/writer/writer-utils.js";
import { describe, expect, it } from "vitest";

describe("MainBindingsWriter, scopes", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);

   const render = async (...channels: shared.SimpleChannel[]) => {
      const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels));
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };
   const invoke = (scopes?: string[], extra: Partial<shared.SimpleChannel> = {}) =>
      ({
         name: "getIt",
         kind: "Unicast",
         direction: "RendererToMain",
         returnType: "Promise<string>",
         ...(scopes ? { scopes } : {}),
         ...extra,
      }) as shared.SimpleChannel;
   const send = (scopes?: string[]) =>
      ({
         name: "sendIt",
         kind: "Broadcast",
         direction: "RendererToMain",
         ...(scopes ? { scopes } : {}),
      }) as shared.SimpleChannel;
   const emit = (scopes?: string[]) =>
      ({
         name: "pushIt",
         kind: "Broadcast",
         direction: "MainToRenderer",
         ...(scopes ? { scopes } : {}),
      }) as shared.SimpleChannel;

   it("declares the registry of the scopes, in code unit order, ahead of the sender validation", async () => {
      const output = await render(invoke(["settings", "editor"]), send(["Zed"]));

      expect(output).toContain("export type IpcScope = 'Zed' | 'editor' | 'settings';");
      expect(output).toContain(
         "const ipcScopeNames: readonly string[] = ['Zed', 'editor', 'settings'];",
      );
      expect(output.indexOf("export type IpcScope")).toBeLessThan(
         output.indexOf("export class IpcForbiddenError"),
      );
   });

   it("writes registerScope as a function that takes a window, a view or contents", async () => {
      const output = await render(invoke(["settings"]));
      const expected = dedent(`
         export function registerScope(
            target: BrowserWindow | WebContents | WebContentsView,
            scope: IpcScope,
         ): () => void {
            if (!ipcScopeNames.includes(scope)) {
               throw new TypeError(\`The scope '\${scope}' is not declared in the schema. Use one of: \${ipcScopeNames.join(', ')}\`);
            }
            const contents = 'webContents' in target ? target.webContents : target;
            if (contents.isDestroyed()) {
               throw new TypeError('Object has been destroyed');
            }
            const id = contents.id;
            scopeRegistry[id]?.remove();
            const remove = () => {
               if (scopeRegistry[id] === entry) {
                  delete scopeRegistry[id];
               }
               if (!contents.isDestroyed()) {
                  contents.removeListener('destroyed', remove);
               }
            };
            const entry: ScopeEntry = { scope, remove };
            scopeRegistry[id] = entry;
            contents.once('destroyed', remove);
            return remove;
         }
      `);

      expect(output).toContain(expected);
      expect(output).toContain(
         "const scopeRegistry: { [id: string]: ScopeEntry | undefined } = { __proto__: null } as any;",
      );
   });

   it("imports the electron types that registerScope uses, even when no listener needs them", async () => {
      const output = await render(emit(["hud"]));

      expect(output).toMatch(/^import type \{[^}]*\bBrowserWindow\b[^}]*\} from "electron";$/m);
      expect(output).toMatch(/^import type \{[^}]*\bWebContentsView\b[^}]*\} from "electron";$/m);
      expect(output).toMatch(/^import type \{[^}]*\bWebContents\b[^}]*\} from "electron";$/m);
   });

   it("passes the scopes to the check of the sender, after the origins", async () => {
      const output = await render(invoke(["settings", "editor"]), send(["editor"]));

      expect(output).toContain(
         "if (!isSenderAllowed(event, 'getIt', undefined, ['settings', 'editor'])) {",
      );
      expect(output).toContain(
         "const guard = (event: IpcMainEvent) => isSenderAllowed(event, 'sendIt', undefined, ['editor']);",
      );
   });

   it("passes the origins and the scopes of a channel that has both", async () => {
      const output = await render(invoke(["settings"], { allowedOrigins: ["app://."] }));

      expect(output).toContain(
         `if (!isSenderAllowed(event, 'getIt', ["app://."], ['settings'])) {`,
      );
   });

   it("passes no scopes for a channel that has none, next to one that has", async () => {
      const output = await render(invoke(), send(["editor"]));

      expect(output).toContain("if (!isSenderAllowed(event, 'getIt')) {");
      expect(output).toContain("isSenderAllowed(event, 'sendIt', undefined, ['editor'])");
   });

   it("lets isSenderAllowed check the scope of the sender before the origin and the validator", async () => {
      const output = await render(invoke(["settings"]));
      const expected = dedent(`
         function isSenderAllowed(event: IpcMainInvokeEvent, channel: string, allowedOrigins?: string[], scopes?: readonly IpcScope[]): boolean {
            const validateSender = ipcConfig.validateSender;
            if (!allowedOrigins && !scopes && !validateSender) {
               return true;
            }
            let allowed = false;
            try {
               const frame = event.senderFrame;
               const origin = frame ? frame.origin : null;
               const entry = scopes ? scopeRegistry[event.sender.id] : undefined;
               allowed =
                  frame != null &&
                  (!scopes || (entry !== undefined && scopes.includes(entry.scope))) &&
                  (!allowedOrigins || (typeof origin === 'string' && allowedOrigins.includes(origin))) &&
                  (!validateSender || validateSender(event, channel) === true);
            } catch {
               allowed = false;
            }
      `);

      expect(output).toContain(expected);
   });

   it("writes nothing of the scopes for a schema without them", async () => {
      const output = await render(invoke(), send(), emit());

      expect(output).not.toMatch(/IpcScope|registerScope|scopeRegistry|ScopeEntry|ipcScopeNames/);
      expect(output).toContain(
         "function isSenderAllowed(event: IpcMainEvent | IpcMainInvokeEvent, channel: string, allowedOrigins?: string[]): boolean {",
      );
      expect(output).toContain("if (!allowedOrigins && !validateSender) {");
   });

   it("keeps the check of the sender as it was when only channels that it does not guard have scopes", async () => {
      const output = await render(invoke(), emit(["hud"]));

      expect(output).toContain("export function registerScope(");
      expect(output).toContain("allowedOrigins?: string[]): boolean {");
      expect(output).not.toContain("scopes?: readonly IpcScope[]");
      expect(output).not.toContain("scopeRegistry[event.sender.id]");
   });

   it("writes registerScope for a schema which has scopes but no channel to the main process", async () => {
      const output = await render(emit(["hud"]));

      expect(output).toContain("export type IpcScope = 'hud';");
      expect(output).toContain("export function registerScope(");
      expect(output).not.toContain("isSenderAllowed");
   });

   it("reserves the names of the registry, so that a schema type is renamed", () => {
      const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(invoke(["a"])));
      const names = (obj as unknown as { getReservedNames(): string[] }).getReservedNames();

      for (const name of [
         "IpcScope",
         "ScopeEntry",
         "ipcScopeNames",
         "scopeRegistry",
         "registerScope",
      ]) {
         expect(names).toContain(name);
      }
   });
});
