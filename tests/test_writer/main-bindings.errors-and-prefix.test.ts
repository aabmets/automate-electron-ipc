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
import mocks from "@testutils/shared-mocks.js";
import shared from "@testutils/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("MainBindingsWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);

   describe("error envelope", () => {
      const unicast = { name: "getIt", kind: "Unicast", direction: "RendererToMain" } as const;
      const broadcast = { name: "sendIt", kind: "Broadcast", direction: "RendererToMain" } as const;
      const render = async (
         channels: shared.SimpleChannel[],
         config: Partial<t.IPCResolvedConfig> = {},
      ) => {
         const obj = new shared.VitestMainBindingsWriter(
            shared.buildFileSpecs(...channels),
            config,
         );
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      it("answers every invoke through settleInvoke by default", async () => {
         const output = await render([unicast]);

         expect(output).toContain(
            "async function settleInvoke(run: () => unknown): Promise<IpcEnvelope>",
         );
         expect(output).toContain("const handler = (event: IpcMainInvokeEvent) => {");
         expect(output).toContain(
            "settleInvoke(() => (handler as (...rest: unknown[]) => unknown)(event, ...rest));",
         );
         expect(output).toContain("target.ipc.handle('getIt', listener);");
         expect(output).toContain("target.handlers['getIt'] = listener;");
      });

      it("registers the wrapper, not the inner handler, so the disposer compares the right function", async () => {
         const output = await render([unicast]);

         expect(output).toContain("if (target.handlers['getIt'] === listener) {");
         expect(output).not.toContain("=== handler");
      });

      it("writes the envelope helpers once, however many invoke channels there are", async () => {
         const output = await render([unicast, { ...unicast, name: "getOther" }]);

         expect(output.match(/function settleInvoke/g)).toHaveLength(1);
         expect(output.match(/function toIpcError/g)).toHaveLength(1);
         expect(output.match(/settleInvoke\(\(\) =>/g)).toHaveLength(4);
      });

      it("writes no envelope helper when there is no invoke channel", async () => {
         const output = await render([broadcast]);

         expect(output).not.toContain("settleInvoke");
         expect(output).not.toContain("IpcErrorInfo");
         expect(output).not.toContain("structuredClone");
      });

      it("leaves the listener of a send channel without the envelope", async () => {
         const output = await render([unicast, broadcast]);

         expect(output).toContain("target.ipc.on('sendIt', listener);");
         expect(output.match(/settleInvoke\(\(\) =>/g)).toHaveLength(2);
      });

      it("registers the plain listener of an invoke channel when rawErrors is set", async () => {
         const output = await render([unicast], { rawErrors: true });

         expect(output).not.toContain("settleInvoke");
         expect(output).not.toContain("toIpcError");
         expect(output).toContain("const listener = (event: IpcMainInvokeEvent) => {");
         expect(output).toContain("target.ipc.handle('getIt', listener);");
      });

      it("treats rawErrors: false like the default", async () => {
         expect(await render([unicast], { rawErrors: false })).toBe(await render([unicast]));
      });

      it("sends only the name, message, code and data of an error, never the stack", async () => {
         const output = await render([unicast]);

         expect(output).not.toMatch(/\.stack\b/);
         expect(output).toContain("const info: IpcErrorInfo = { name, message };");
      });

      it("gives the errors of the library a code and plain data", async () => {
         const output = await render([
            { ...unicast, validate: { name: "idArgs", exported: "idArgs", fromPath: "./v" } },
         ]);

         expect(output).toContain("readonly code = 'IPC_VALIDATION';");
         expect(output).toContain("readonly code = 'IPC_FORBIDDEN';");
         expect(output).toContain("return typeof key === 'symbol' ? String(key) : key;");
      });

      it("does not let a parameter of the signature shadow the names of the wrapper", async () => {
         const output = await render([
            { ...unicast, params: ["handler: string", "rest: number", "listener: boolean"] },
         ]);

         expect(output).toContain("const _handler = (event: IpcMainInvokeEvent, handler: string");
         expect(output).toContain(
            "const _listener = (event: IpcMainInvokeEvent, ..._rest: unknown[])",
         );
         expect(output).toContain(
            "(_handler as (..._rest: unknown[]) => unknown)(event, ..._rest)",
         );
      });

      it("reserves the names of the generated helpers, so that a schema type is renamed", () => {
         const reserved = [
            "IpcErrorInfo",
            "IpcEnvelope",
            "toIpcError",
            "settleInvoke",
            "structuredClone",
         ];
         const generator = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(unicast));
         const names = (
            generator as unknown as { getReservedNames(): string[] }
         ).getReservedNames();

         for (const name of reserved) {
            expect(names).toContain(name);
         }
      });
   });

   describe("channel prefix", () => {
      const unicast = { name: "getIt", kind: "Unicast", direction: "RendererToMain" } as const;
      const broadcast = { name: "sendIt", kind: "Broadcast", direction: "RendererToMain" } as const;
      const emit = {
         name: "pushIt",
         kind: "Broadcast",
         direction: "MainToRenderer",
         trigger: "focus",
      } as const;
      const port = { name: "chatIt", kind: "Port", direction: "RendererToRenderer" } as const;
      const render = async (config: Partial<t.IPCResolvedConfig>) => {
         const specs = shared.buildFileSpecs(unicast, broadcast, emit, port);
         const obj = new shared.VitestMainBindingsWriter(specs, config);
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      it("puts the prefix in front of every name that is passed to Electron", async () => {
         const output = await render({ channelPrefix: "app:" });

         expect(output).toContain("target.ipc.handle('app:getIt', listener);");
         expect(output).toContain("target.ipc.removeHandler('app:getIt');");
         expect(output).toContain("target.ipc.on('app:sendIt', listener);");
         expect(output).toContain("target.ipc.off('app:sendIt', listener);");
         expect(output).toContain("webContents.send('app:pushIt', ");
         expect(output).toContain("connectPorts('app:chatIt', winA, winB)");
         expect(output).toContain("ends[0].contents.postMessage(channel, ends[0].key, [port1]);");
         expect(output).toContain("end.contents.send(`${channel}:close`, end.key);");
         expect(output).toContain("electronIpcMain.on(`${channel}:disconnect`, ");
      });

      it("leaves the names for hooks, errors and the registry as they are in the schema", async () => {
         const output = await render({ channelPrefix: "app:" });

         expect(output).toContain("isSenderAllowed(event, 'getIt')");
         expect(output).toContain("new IpcForbiddenError('getIt')");
         expect(output).toContain("target.handlers['getIt'] = listener;");
         expect(output).not.toMatch(/'app:(getIt|sendIt)'\)\)/);
         expect(output).not.toContain("handlers['app:");
      });

      it("writes the names as they are without a prefix, and when the config has none", async () => {
         const bare = await render({ channelPrefix: "" });

         expect(bare).toContain("target.ipc.handle('getIt', listener);");
         expect(bare).toContain("webContents.send('pushIt', ");
         expect(await render({})).toBe(bare);
      });

      it("writes the name of a trigger binder with the prefix too", async () => {
         const output = await render({ channelPrefix: "app:" });

         expect(output).toContain("browserWindow.webContents.send('app:pushIt', ...args);");
         expect(output).toContain("resolveSendTarget(target).send('app:pushIt', ");
         expect(output).toContain("broadcastMessage('app:pushIt', ");
      });
   });
});
