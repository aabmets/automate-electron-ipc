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

   describe("argument validation", () => {
      const render = async (...channels: shared.SimpleChannel[]) => {
         const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels));
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };
      const validate = { name: "idArgs", exported: "idArgs", fromPath: "./validators" };
      const unicast = {
         name: "getIt",
         kind: "Unicast",
         direction: "RendererToMain",
         params: ["id: number"],
         returnType: "Promise<string>",
         validate,
      } as const;
      const broadcast = {
         name: "sendIt",
         kind: "Broadcast",
         direction: "RendererToMain",
         params: ["text: string", "...rest: number[]"],
         validate: { name: "lineArgs", exported: "lineArgs", fromPath: "./validators" },
      } as const;

      it("generates nothing for validation when no channel has a validator", async () => {
         const output = await render(
            { ...unicast, validate: undefined },
            { ...broadcast, validate: undefined },
         );
         for (const name of ["IpcValidationError", "validateArguments", "IpcArgumentsSchema"]) {
            expect(output).not.toContain(name);
         }
         expect(output).toContain(
            "onRejected?: (event: IpcMainEvent | IpcMainInvokeEvent, channel: string) => void;",
         );
         expect(output).toContain("ipcConfig.onRejected(event, channel);");
      });

      it("imports each validator as a value, once, next to the electron imports", async () => {
         const output = await render(unicast, broadcast, { ...unicast, name: "getThat" });
         // The path is relative to the target file, which these tests do not place.
         const lines = output.split("\n").filter((line) => line.startsWith("import {"));
         expect(lines.filter((line) => /validators";$/.test(line))).toStrictEqual([
            expect.stringMatching(/^import \{ idArgs \} from "[^"]*validators";$/),
            expect.stringMatching(/^import \{ lineArgs \} from "[^"]*validators";$/),
         ]);
         expect(output).not.toContain("import type { idArgs");
      });

      it("generates the error, the schema types and the validation function", async () => {
         const output = await render(unicast, broadcast);

         expect(output).toContain("export class IpcValidationError extends Error {");
         expect(output).toContain("readonly issues: readonly IpcValidationIssue[];");
         expect(output).toContain("export interface IpcValidationIssue {");
         expect(output).toContain("function validateArguments<R>(");
         expect(output).toContain("outcome = schema['~standard'].validate(received);");
         // The hook learns why a call was rejected.
         expect(output).toContain(
            "onRejected?: (event: IpcMainEvent | IpcMainInvokeEvent, channel: string, error: IpcForbiddenError | IpcValidationError) => void;",
         );
         expect(output).toContain(
            "ipcConfig.onRejected(event, channel, new IpcForbiddenError(channel));",
         );
         expect(output).toContain("ipcConfig.onRejected?.(event, channel, error);");
         // Nothing the generated file imports from this library.
         expect(output).not.toContain("automate-electron-ipc");
         expect(output).not.toMatch(/\bany\b/);
      });

      it("validates after the sender check, with the arguments as they arrived", async () => {
         const output = await render(unicast);

         expect(output).toContain(
            "const handler = (event: IpcMainInvokeEvent, ...received: unknown[]) => {",
         );
         expect(output).toMatch(
            /guard\(event\);\n\s+return validateArguments\(event, 'getIt', idArgs, received, false, \(args\) => \{\n\s+return call\(event, \.\.\.args\);/,
         );
         expect(output).toContain(
            "const call = callback as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;",
         );
         // The callback keeps the declared signature.
         expect(output).toContain(
            "handle: (callback: (event: IpcMainInvokeEvent, id: number) => Promise<string>, options?: IpcListenOptions)",
         );
      });

      it("drops invalid messages of Broadcast channels, and rejects those of Unicast channels", async () => {
         const output = await render(unicast, broadcast);

         expect(output).toContain(
            "validateArguments(event, 'getIt', idArgs, received, false, (args) => {",
         );
         expect(output).toContain(
            "validateArguments(event, 'sendIt', lineArgs, received, true, (args) => {",
         );
      });

      it("uses up once and handleOnce on the first valid message only", async () => {
         const output = await render(unicast, broadcast);

         const once = output.match(
            /let spent = false;[\s\S]*?remove\(\);\n\s+return call\(event, \.\.\.args\);/g,
         );
         expect(once).toHaveLength(2);
         expect(once?.[0]).toContain("throw new Error(\"No handler registered for 'getIt'\");");
         expect(once?.[1]).toMatch(/if \(spent\) \{\n\s+return;\n/);
         expect(once?.[1]).toContain("spent = true;");
         // Nothing is removed before the schema accepts the message.
         expect(output.match(/let spent = false;/g)).toHaveLength(2);
      });

      it("keeps unvalidated channels as they were", async () => {
         const output = await render(unicast, { ...broadcast, validate: undefined });

         expect(output).toContain(
            "const listener = (event: IpcMainEvent, text: string, ...rest: number[]) => {",
         );
         expect(output).toContain("return callback(event, text, ...rest);");
      });

      it("does not shadow the validator, the callback or the event with generated names", async () => {
         const clash = {
            name: "clashIt",
            kind: "Broadcast",
            direction: "RendererToMain",
            params: ["received: string", "args: number", "call: boolean", "spent: string"],
            validate: { name: "listener", exported: "listener", fromPath: "./validators" },
         } as const;
         const output = await render(clash);

         expect(output).toMatch(/^import \{ listener \} from "[^"]*validators";$/m);
         expect(output).toContain(
            "const _listener = (event: IpcMainEvent, ..._received: unknown[]) => {",
         );
         expect(output).toContain(
            "validateArguments(event, 'clashIt', listener, _received, true, (_args) => {",
         );
         expect(output).toContain("return _call(event, ..._args);");
         expect(output).toContain("let _spent = false;");
      });

      it("imports a validator whose name is reserved or taken under another name", async () => {
         const reserved = {
            ...unicast,
            validate: { name: "ipc", exported: "ipc", fromPath: "./v" },
         };
         const taken = {
            ...broadcast,
            validate: { name: "validateArguments", exported: "default", fromPath: "./w" },
         };
         const output = await render(reserved, taken);

         expect(output).toMatch(/^import \{ ipc as ipc_2 \} from "[^"]*\/v";$/m);
         expect(output).toMatch(/^import validateArguments_2 from "[^"]*\/w";$/m);
         expect(output).toContain("validateArguments(event, 'getIt', ipc_2, received, false,");
         expect(output).toContain(
            "validateArguments(event, 'sendIt', validateArguments_2, received, true,",
         );
      });
   });
});
