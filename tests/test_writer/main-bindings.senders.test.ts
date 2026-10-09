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
import { describe, expect, it } from "vitest";

describe("MainBindingsWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);

   describe("sender validation", () => {
      const render = async (...channels: shared.SimpleChannel[]) => {
         const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels));
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };
      const unicast = {
         name: "getIt",
         kind: "Unicast",
         direction: "RendererToMain",
         returnType: "Promise<string>",
      } as const;
      const broadcast = { name: "sendIt", kind: "Broadcast", direction: "RendererToMain" } as const;

      it("checks the sender first in every listener, and rejects Unicast with an error", async () => {
         const output = await render(unicast, broadcast);

         const throwing =
            /const guard = \(event: IpcMainInvokeEvent\) => \{\n\s+if \(!isSenderAllowed\(event, 'getIt'\)\) \{\n\s+throw new IpcForbiddenError\('getIt'\);/g;
         expect(output.match(throwing)).toHaveLength(2);
         expect(
            output.match(
               /const guard = \(event: IpcMainEvent\) => isSenderAllowed\(event, 'sendIt'\);/g,
            ),
         ).toHaveLength(2);
         // The guard runs before the callback.
         expect(
            output.match(/guard\(event\);\n\s+(remove\(\);\n\s+)?return callback\(event\);/g),
         ).toHaveLength(2);
         expect(
            output.match(
               /if \(!guard\(event\)\) \{\n\s+return;\n\s+\}\n\s+(remove\(\);\n\s+)?return callback\(event\);/g,
            ),
         ).toHaveLength(2);
         expect(output).toContain("export function configureIpc(config: IpcConfig): void {");
         expect(output).toContain("export class IpcForbiddenError extends Error {");
         expect(output).toContain("validateSender?: (event: IpcMainEvent | IpcMainInvokeEvent");
      });

      it("passes the allowed origins of the channel as a list of string literals", async () => {
         const output = await render(
            { ...unicast, allowedOrigins: ["app://.", "http://localhost:5173"] },
            { ...broadcast, allowedOrigins: ['a"b://x'] },
         );

         expect(output).toContain(
            `isSenderAllowed(event, 'getIt', ["app://.", "http://localhost:5173"])`,
         );
         expect(output).toContain(`isSenderAllowed(event, 'sendIt', ["a\\"b://x"])`);
      });

      it("passes no list for a channel without allowed origins", async () => {
         const output = await render(unicast);
         expect(output).toContain("isSenderAllowed(event, 'getIt'))");
         expect(output).not.toContain("allowedOrigins)");
      });

      it("compares the origin for equality and rejects a missing frame", async () => {
         const output = await render(unicast);

         expect(output).toContain("allowedOrigins.includes(origin)");
         expect(output).toContain("frame != null &&");
         expect(output).not.toMatch(/startsWith|indexOf|\.test\(|new URL/);
      });

      it("types the event of the validator with the events that the channels use", async () => {
         expect(await render(unicast)).toContain(
            "validateSender?: (event: IpcMainInvokeEvent, channel: string) => boolean;",
         );
         expect(await render(broadcast)).toContain(
            "validateSender?: (event: IpcMainEvent, channel: string) => boolean;",
         );
      });

      it("generates no sender validation without renderer-to-main channels", async () => {
         const output = await render({
            name: "pushIt",
            kind: "Broadcast",
            direction: "MainToRenderer",
         });

         expect(output).not.toMatch(/configureIpc|IpcForbiddenError|isSenderAllowed/);
      });

      it("does not let a parameter of the signature shadow a name that the listener calls", async () => {
         const output = await render({
            ...unicast,
            params: [
               "isSenderAllowed: string",
               "IpcForbiddenError: string",
               "registeredHandlers: string",
               "electronIpcMain: string",
               "guard: string",
               "remove: string",
            ],
         });

         // The listener only calls local functions, whose names the parameters do not take.
         const listener = /const handler = \((.*)\) => \{\n([\s\S]*?)\n\s+\};/.exec(output);
         expect(listener?.[1]).toContain("guard: string, remove: string");
         expect(listener?.[2]).toContain("_guard(event);");
         // Only the forwarded call names the parameters.
         const beforeReturn = listener?.[2].split("return ")[0];
         expect(beforeReturn).not.toMatch(
            /isSenderAllowed|IpcForbiddenError|registeredHandlers|electronIpcMain/,
         );
      });
   });
});
