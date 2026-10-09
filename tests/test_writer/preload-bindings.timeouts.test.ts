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

describe("PreloadBindingsWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestPreloadBindingsWriter);

   describe("utility process timeouts", () => {
      const invokeUtility = {
         name: "queryRows",
         kind: "Unicast",
         direction: "RendererToUtility",
      } as const;
      const streamUtility = {
         name: "scanRows",
         kind: "Stream",
         direction: "RendererToUtility",
         returnType: "AsyncIterable<number>",
      } as const;
      const render = async (
         channels: shared.SimpleChannel[],
         config: Partial<t.IPCResolvedConfig> = {},
      ) => {
         const obj = new shared.VitestPreloadBindingsWriter(
            shared.buildFileSpecs(...channels),
            config,
         );
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      it("passes the timeout of a call as the last argument, and none without one", async () => {
         const output = await render([
            { ...invokeUtility, timeoutMs: 1200 },
            { ...invokeUtility, name: "patient", timeoutMs: 0 },
            { ...invokeUtility, name: "plain" },
         ]);

         expect(output).toContain("callUtilityPort(utilityClients['queryRows'], args, 1200)");
         expect(output).toContain("callUtilityPort(utilityClients['patient'], args)");
         expect(output).toContain("callUtilityPort(utilityClients['plain'], args)");
      });

      it("applies the default of the config to a call, but not to a stream", async () => {
         const output = await render([invokeUtility, streamUtility], { timeoutMs: 2500 });

         expect(output).toContain("callUtilityPort(utilityClients['queryRows'], args, 2500)");
         expect(output).toMatch(/openUtilityStream\(utilityClients\['scanRows'\], args, \d+\)/);
      });

      it("passes the timeout of a stream after its window", async () => {
         const output = await render([{ ...streamUtility, highWaterMark: 4, timeoutMs: 700 }]);

         expect(output).toContain("openUtilityStream(utilityClients['scanRows'], args, 4, 700)");
      });

      it("cancels a stream in the child when it times out", async () => {
         const output = await render([{ ...streamUtility, timeoutMs: 700 }]);

         expect(output).toContain("'IPC_UTILITY_TIMEOUT'");
         expect(output).toContain("timeoutMs = 0) {");
         expect(output).toContain(
            "client.port?.postMessage({ __ipc: 'cancel', channel: client.channel, id });",
         );
      });

      it("does not write withTimeout, which is only for the invoke of the main process", async () => {
         const output = await render([invokeUtility], { timeoutMs: 2500 });

         expect(output).not.toContain("withTimeout");
         expect(output).not.toContain("IpcTimeoutError");
      });
   });

   describe("invoke timeouts", () => {
      const unicast = { name: "getIt", kind: "Unicast", direction: "RendererToMain" } as const;
      const other = { name: "getOther", kind: "Unicast", direction: "RendererToMain" } as const;
      const broadcast = { name: "sendIt", kind: "Broadcast", direction: "RendererToMain" } as const;
      const render = async (
         channels: shared.SimpleChannel[],
         config: Partial<t.IPCResolvedConfig> = {},
      ) => {
         const obj = new shared.VitestPreloadBindingsWriter(
            shared.buildFileSpecs(...channels),
            config,
         );
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      it("generates nothing for a channel without a timeout", async () => {
         const output = await render([unicast]);

         expect(output).not.toContain("withTimeout");
         expect(output).not.toContain("IpcTimeoutError");
         expect(output).toBe(await render([unicast], { timeoutMs: 0 }));
      });

      it("races the invoke of a channel with the timeoutMs option", async () => {
         const output = await render([{ ...unicast, timeoutMs: 500 }, other]);

         expect(output).toContain(
            "const result = await withTimeout('getIt', 500, ipcRenderer.invoke('getIt', ...args));",
         );
         expect(output).toContain("const result = await ipcRenderer.invoke('getOther', ...args);");
         expect(output).toContain("function withTimeout<T>(channel: string, timeoutMs: number");
      });

      it("rejects with the plain object of the timeout error, not with an Error", async () => {
         const output = await render([{ ...unicast, timeoutMs: 500 }]);

         expect(output).toContain(
            "reject({ name: 'IpcTimeoutError', message, code: 'IPC_TIMEOUT' });",
         );
         expect(output).not.toContain("new Error");
      });

      it("clears the timer when the call settles, and caps it at what a timer holds", async () => {
         const output = await render([{ ...unicast, timeoutMs: 500 }]);

         expect(output.match(/clearTimeout\(timer\)/g)).toHaveLength(2);
         expect(output).toContain("Math.min(timeoutMs, 2147483647)");
      });

      it("applies the timeout of the config to every invoke", async () => {
         const output = await render([unicast, other, broadcast], { timeoutMs: 2500 });

         expect(output).toContain(
            "withTimeout('getIt', 2500, ipcRenderer.invoke('getIt', ...args))",
         );
         expect(output).toContain(
            "withTimeout('getOther', 2500, ipcRenderer.invoke('getOther', ...args))",
         );
         expect(output).toContain("send: (...args: any[]) => ipcRenderer.send('sendIt', ...args),");
         expect(output.match(/function withTimeout/g)).toHaveLength(1);
      });

      it("lets the option override the config, and 0 turn the timeout off", async () => {
         const output = await render(
            [
               { ...unicast, timeoutMs: 100 },
               { ...other, timeoutMs: 0 },
            ],
            {
               timeoutMs: 2500,
            },
         );

         expect(output).toContain("withTimeout('getIt', 100,");
         expect(output).toContain("const result = await ipcRenderer.invoke('getOther', ...args);");
      });

      it("races the raw invoke when rawErrors is set", async () => {
         const output = await render([{ ...unicast, timeoutMs: 500 }], { rawErrors: true });

         expect(output).toContain(
            "invoke: (...args: any[]) => withTimeout('getIt', 500, ipcRenderer.invoke('getIt', ...args)),",
         );
      });

      it("times the wire name, which carries the prefix", async () => {
         const output = await render([{ ...unicast, timeoutMs: 500 }], { channelPrefix: "app:" });

         expect(output).toContain(
            "withTimeout('getIt', 500, ipcRenderer.invoke('app:getIt', ...args))",
         );
      });

      it("ignores the timeout for send and ask channels", async () => {
         const ask = { name: "askIt", kind: "Unicast", direction: "MainToRenderer" } as const;
         const output = await render([broadcast, ask], { timeoutMs: 2500 });

         expect(output).not.toContain("withTimeout");
      });
   });
});
