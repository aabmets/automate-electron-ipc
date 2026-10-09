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
import mocks from "@testutils/writer/shared-mocks.js";
import shared from "@testutils/writer/writer-utils.js";
import { describe, expect, it } from "vitest";

describe("MainBindingsWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);

   it("should import only the event types that the channels use", async () => {
      // Regression for B6: Unicast handlers get an IpcMainInvokeEvent, Broadcast ones an IpcMainEvent.
      const render = async (...channels: shared.SimpleChannel[]) => {
         const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels));
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };
      const unicast = { name: "getIt", kind: "Unicast", direction: "RendererToMain" } as const;
      const broadcast = { name: "sendIt", kind: "Broadcast", direction: "RendererToMain" } as const;

      const both = await render(unicast, broadcast);
      expect(both).toContain(
         'import type { IpcMainInvokeEvent, IpcMainEvent, IpcMain, WebContents } from "electron";',
      );
      const onlyUnicast = await render(unicast);
      expect(onlyUnicast).toContain(
         'import type { IpcMainInvokeEvent, IpcMain, WebContents } from "electron";',
      );
      expect(onlyUnicast).not.toContain("IpcMainEvent");
      const none = await render();
      expect(none).not.toContain("import type");
   });

   it("should enforce the declared signature in the handler wrappers", async () => {
      const pfsArray = shared.buildFileSpecs(
         {
            name: "restIt",
            kind: "Broadcast",
            direction: "RendererToMain",
            params: ["label: string", "flag?: boolean", "...rest: number[]"],
         },
         { name: "bareIt", kind: "Unicast", direction: "RendererToMain", returnType: "number" },
      );
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      expect(output).toContain(
         "const listener = (event: IpcMainEvent, label: string, flag?: boolean, ...rest: number[]) => {",
      );
      expect(output).toContain("return callback(event, label, flag, ...rest);");
      expect(output).toContain("const handler = (event: IpcMainInvokeEvent) => {");
      expect(output).toContain("return callback(event);");
      expect(output).not.toMatch(/\bany\b/);
   });

   it("should not shadow the callback or the event with parameters of the signature", async () => {
      const pfsArray = shared.buildFileSpecs({
         name: "clashIt",
         kind: "Broadcast",
         direction: "RendererToMain",
         params: ["callback: string", "event: number"],
      });
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      expect(output).toContain(
         "on: (_callback: (_event: IpcMainEvent, callback: string, event: number) => void, options?: IpcListenOptions)",
      );
      expect(output).toContain(
         "const listener = (_event: IpcMainEvent, callback: string, event: number) => {",
      );
      expect(output).toContain("const guard = (_event: IpcMainEvent) =>");
      expect(output).toContain("if (!guard(_event)) {");
      expect(output).toContain("return _callback(_event, callback, event);");
   });

   it("should not shadow the listener or the registry with parameters of the signature", async () => {
      const pfsArray = shared.buildFileSpecs({
         name: "clashIt",
         kind: "Unicast",
         direction: "RendererToMain",
         params: ["listener: string"],
      });
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      expect(output).toContain("const handler = (event: IpcMainInvokeEvent, listener: string)");
      expect(output).toContain("const _listener = (event: IpcMainInvokeEvent, ...rest: unknown[])");
      expect(output).toContain("target.ipc.handle('clashIt', _listener);");
      expect(output).toContain("if (target.handlers['clashIt'] === _listener) {");
   });

   it("should register the handlers of invoke channels in the registry of the target only", async () => {
      const render = async (...channels: shared.SimpleChannel[]) => {
         const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels));
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };
      const unicast = { name: "getIt", kind: "Unicast", direction: "RendererToMain" } as const;
      const broadcast = { name: "sendIt", kind: "Broadcast", direction: "RendererToMain" } as const;

      expect(await render(unicast)).toContain("target.handlers['getIt'] = listener;");
      expect(await render(broadcast)).not.toContain("handlers[");
      expect(await render(broadcast)).not.toContain("removeHandler(");
   });

   it("should write one object per channel, sorted by name, with no top-level helpers", async () => {
      const pfsArray = shared.buildFileSpecs(
         { name: "zeta", kind: "Broadcast", direction: "MainToRenderer" },
         { name: "alpha", kind: "Port", direction: "RendererToRenderer" },
         { name: "Beta", kind: "Unicast", direction: "RendererToMain" },
         { name: "gamma", kind: "Broadcast", direction: "RendererToMain" },
      );
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

      const keys = [...output.matchAll(/^ {3}(\w+): \{$/gm)].map((match) => match[1]);
      expect(keys).toStrictEqual(["Beta", "alpha", "gamma", "zeta"]);
      expect(output).not.toMatch(/^ {3}ports: \{/m);
      expect(output).not.toMatch(/\b(propagate|onBeta|sendZeta)\b/);
   });

   it("should import ipcMain from electron only where it is used", async () => {
      // Regression for T65: the import was unused, and failed under noUnusedLocals, without them.
      const render = async (...channels: shared.SimpleChannel[]) => {
         const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels));
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };
      const toRenderer = await render({
         name: "a",
         kind: "Broadcast",
         direction: "MainToRenderer",
      });
      const port = await render({ name: "p", kind: "Port", direction: "RendererToRenderer" });
      const toMain = await render({ name: "b", kind: "Broadcast", direction: "RendererToMain" });
      const both = await render(
         { name: "p", kind: "Port", direction: "RendererToRenderer" },
         { name: "b", kind: "Broadcast", direction: "RendererToMain" },
      );

      expect(toRenderer).not.toContain("electronIpcMain");
      expect(
         toRenderer.startsWith('import { webContents as electronWebContents } from "electron";'),
      ).toBe(true);
      // A port channel listens for the page that ends a connection.
      expect(
         port.startsWith("import { ipcMain as electronIpcMain, MessageChannelMain } from"),
      ).toBe(true);
      expect(toMain.startsWith('import { ipcMain as electronIpcMain } from "electron";')).toBe(
         true,
      );
      expect(
         both.startsWith("import { ipcMain as electronIpcMain, MessageChannelMain } from"),
      ).toBe(true);
   });
});
