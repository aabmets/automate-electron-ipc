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
import utils from "@src/utils.js";
import mocks from "@testutils/shared-mocks.js";
import shared from "@testutils/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

describe("MainBindingsWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);

   it("should write empty ipc object when pfsArray is empty", async () => {
      const obj = new shared.VitestMainBindingsWriter([]);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = "export const ipc = {};";
      expect(buffer.toString()).toStrictEqual(expectedOutput);
   });

   it("should write Unicast RendererToMain callables into ipc object", async () => {
      const pfsArray = shared.vitestChannelSpecs.Unicast_RendererToMain;
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { ipcMain as electronIpcMain } from "electron";
         import type { IpcMainInvokeEvent } from "electron";

         export class IpcForbiddenError extends Error {
            readonly code = 'IPC_FORBIDDEN';
            readonly channel: string;
            constructor(channel: string) {
               super(\`The sender of the message is not allowed to use the channel '\${channel}'\`);
               this.name = 'IpcForbiddenError';
               this.channel = channel;
            }
         }

         export interface IpcConfig {
            validateSender?: (event: IpcMainInvokeEvent, channel: string) => boolean;
            onRejected?: (event: IpcMainInvokeEvent, channel: string) => void;
         }

         let ipcConfig: IpcConfig = {};

         export function configureIpc(config: IpcConfig): void {
            ipcConfig = { validateSender: config.validateSender, onRejected: config.onRejected };
         }

         function isSenderAllowed(event: IpcMainInvokeEvent, channel: string, allowedOrigins?: string[]): boolean {
            const validateSender = ipcConfig.validateSender;
            if (!allowedOrigins && !validateSender) {
               return true;
            }
            let allowed = false;
            try {
               const frame = event.senderFrame;
               const origin = frame ? frame.origin : null;
               allowed =
                  frame != null &&
                  (!allowedOrigins || (typeof origin === 'string' && allowedOrigins.includes(origin))) &&
                  (!validateSender || validateSender(event, channel) === true);
            } catch {
               allowed = false;
            }
            if (!allowed && ipcConfig.onRejected) {
               try {
                  ipcConfig.onRejected(event, channel);
               } catch {
                  // A failing hook must not decide whether the call is rejected.
               }
            }
            return allowed;
         }

         interface IpcErrorInfo {
            name: string;
            message: string;
            code?: string | number;
            data?: unknown;
         }

         type IpcEnvelope = { ok: true; value: unknown } | { ok: false; error: IpcErrorInfo };

         function toIpcError(error: unknown): IpcErrorInfo {
            try {
               const source = typeof error === 'object' && error !== null ? (error as { [key: string]: unknown }) : null;
               const name = source && typeof source.name === 'string' && source.name ? source.name : 'Error';
               const message = source && typeof source.message === 'string' ? source.message : String(error);
               const info: IpcErrorInfo = { name, message };
               if (source && (typeof source.code === 'string' || typeof source.code === 'number')) {
                  info.code = source.code;
               }
               if (source && source.data !== undefined) {
                  try {
                     info.data = structuredClone(source.data);
                  } catch {
                     // Data that cannot be cloned is left out.
                  }
               }
               return info;
            } catch {
               return { name: 'Error', message: 'The handler failed with an unreadable error' };
            }
         }

         async function settleInvoke(run: () => unknown): Promise<IpcEnvelope> {
            try {
               return { ok: true, value: await run() };
            } catch (error) {
               return { ok: false, error: toIpcError(error) };
            }
         }

         const registeredHandlers: { [channel: string]: unknown } = { __proto__: null };

         export const ipc = {
            vitestChannel: {
               handle: (callback: (event: IpcMainInvokeEvent, arg1: CustomType, arg2?: CustomType) => Promise<string>) => {
                  const guard = (event: IpcMainInvokeEvent) => {
                     if (!isSenderAllowed(event, 'vitestChannel')) {
                        throw new IpcForbiddenError('vitestChannel');
                     }
                  };
                  const remove = () => {
                     if (registeredHandlers['vitestChannel'] === listener) {
                        delete registeredHandlers['vitestChannel'];
                        electronIpcMain.removeHandler('vitestChannel');
                     }
                  };
                  const handler = (event: IpcMainInvokeEvent, arg1: CustomType, arg2?: CustomType) => {
                     guard(event);
                     return callback(event, arg1, arg2);
                  };
                  const listener = (event: IpcMainInvokeEvent, ...rest: unknown[]) =>
                     settleInvoke(() => (handler as (...rest: unknown[]) => unknown)(event, ...rest));
                  electronIpcMain.removeHandler('vitestChannel');
                  electronIpcMain.handle('vitestChannel', listener);
                  registeredHandlers['vitestChannel'] = listener;
                  return remove;
               },
               handleOnce: (callback: (event: IpcMainInvokeEvent, arg1: CustomType, arg2?: CustomType) => Promise<string>) => {
                  const guard = (event: IpcMainInvokeEvent) => {
                     if (!isSenderAllowed(event, 'vitestChannel')) {
                        throw new IpcForbiddenError('vitestChannel');
                     }
                  };
                  const remove = () => {
                     if (registeredHandlers['vitestChannel'] === listener) {
                        delete registeredHandlers['vitestChannel'];
                        electronIpcMain.removeHandler('vitestChannel');
                     }
                  };
                  const handler = (event: IpcMainInvokeEvent, arg1: CustomType, arg2?: CustomType) => {
                     guard(event);
                     remove();
                     return callback(event, arg1, arg2);
                  };
                  const listener = (event: IpcMainInvokeEvent, ...rest: unknown[]) =>
                     settleInvoke(() => (handler as (...rest: unknown[]) => unknown)(event, ...rest));
                  electronIpcMain.removeHandler('vitestChannel');
                  electronIpcMain.handle('vitestChannel', listener);
                  registeredHandlers['vitestChannel'] = listener;
                  return remove;
               },
            },
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   it("should write Broadcast RendererToMain callables into ipc object", async () => {
      const pfsArray = shared.vitestChannelSpecs.Broadcast_RendererToMain;
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { ipcMain as electronIpcMain } from "electron";
         import type { IpcMainEvent } from "electron";

         export class IpcForbiddenError extends Error {
            readonly code = 'IPC_FORBIDDEN';
            readonly channel: string;
            constructor(channel: string) {
               super(\`The sender of the message is not allowed to use the channel '\${channel}'\`);
               this.name = 'IpcForbiddenError';
               this.channel = channel;
            }
         }

         export interface IpcConfig {
            validateSender?: (event: IpcMainEvent, channel: string) => boolean;
            onRejected?: (event: IpcMainEvent, channel: string) => void;
         }

         let ipcConfig: IpcConfig = {};

         export function configureIpc(config: IpcConfig): void {
            ipcConfig = { validateSender: config.validateSender, onRejected: config.onRejected };
         }

         function isSenderAllowed(event: IpcMainEvent, channel: string, allowedOrigins?: string[]): boolean {
            const validateSender = ipcConfig.validateSender;
            if (!allowedOrigins && !validateSender) {
               return true;
            }
            let allowed = false;
            try {
               const frame = event.senderFrame;
               const origin = frame ? frame.origin : null;
               allowed =
                  frame != null &&
                  (!allowedOrigins || (typeof origin === 'string' && allowedOrigins.includes(origin))) &&
                  (!validateSender || validateSender(event, channel) === true);
            } catch {
               allowed = false;
            }
            if (!allowed && ipcConfig.onRejected) {
               try {
                  ipcConfig.onRejected(event, channel);
               } catch {
                  // A failing hook must not decide whether the call is rejected.
               }
            }
            return allowed;
         }

         export const ipc = {
            vitestChannel: {
               on: (callback: (event: IpcMainEvent, arg1: string, arg2: string) => void) => {
                  const guard = (event: IpcMainEvent) => isSenderAllowed(event, 'vitestChannel');
                  const remove = () => {
                     electronIpcMain.off('vitestChannel', listener);
                  };
                  const listener = (event: IpcMainEvent, arg1: string, arg2: string) => {
                     if (!guard(event)) {
                        return;
                     }
                     return callback(event, arg1, arg2);
                  };
                  electronIpcMain.on('vitestChannel', listener);
                  return remove;
               },
               once: (callback: (event: IpcMainEvent, arg1: string, arg2: string) => void) => {
                  const guard = (event: IpcMainEvent) => isSenderAllowed(event, 'vitestChannel');
                  const remove = () => {
                     electronIpcMain.off('vitestChannel', listener);
                  };
                  const listener = (event: IpcMainEvent, arg1: string, arg2: string) => {
                     if (!guard(event)) {
                        return;
                     }
                     remove();
                     return callback(event, arg1, arg2);
                  };
                  electronIpcMain.on('vitestChannel', listener);
                  return remove;
               },
            },
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   it("should write Broadcast MainToRenderer callables into ipc object", async () => {
      const pfsArray = shared.vitestChannelSpecs.Broadcast_MainToRenderer;
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { webContents as electronWebContents } from "electron";
         import type { BrowserWindow, WebContents, WebContentsView, WebFrameMain } from "electron";

         function resolveSendTarget(
            target: BrowserWindow | WebContents | WebContentsView | WebFrameMain,
         ): WebContents | WebFrameMain {
            return 'webContents' in target ? target.webContents : target;
         }

         function broadcastMessage(
            channel: string,
            args: unknown[],
            filter?: (contents: WebContents) => boolean,
         ): void {
            for (const contents of electronWebContents.getAllWebContents()) {
               if (!contents.isDestroyed() && (!filter || filter(contents))) {
                  contents.send(channel, ...args);
               }
            }
         }

         function sendToSenderFrame(
            event: { readonly senderFrame: WebFrameMain | null },
            channel: string,
            args: unknown[],
         ): boolean {
            let frame: WebFrameMain | null = null;
            try {
               frame = event.senderFrame;
               if (frame && (frame.isDestroyed?.() || frame.detached)) {
                  frame = null;
               }
            } catch {
               frame = null;
            }
            if (!frame) {
               return false;
            }
            frame.send(channel, ...args);
            return true;
         }

         export const ipc = {
            vitestChannel: {
               send: (target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, arg1: number, ...arg2: number[]) =>
                  resolveSendTarget(target).send('vitestChannel', arg1, ...arg2),
               sendToSender: (event: { readonly senderFrame: WebFrameMain | null }, arg1: number, ...arg2: number[]) =>
                  sendToSenderFrame(event, 'vitestChannel', [arg1, ...arg2]),
               broadcast: (arg1: number, ...arg2: number[]) =>
                  broadcastMessage('vitestChannel', [arg1, ...arg2]),
               broadcastTo: (filter: (contents: WebContents) => boolean, arg1: number, ...arg2: number[]) =>
                  broadcastMessage('vitestChannel', [arg1, ...arg2], filter),
            },
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

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
      expect(both).toContain('import type { IpcMainInvokeEvent, IpcMainEvent } from "electron";');
      const onlyUnicast = await render(unicast);
      expect(onlyUnicast).toContain('import type { IpcMainInvokeEvent } from "electron";');
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
         "on: (_callback: (_event: IpcMainEvent, callback: string, event: number) => void)",
      );
      expect(output).toContain(
         "const listener = (_event: IpcMainEvent, callback: string, event: number) => {",
      );
      expect(output).toContain("const guard = (_event: IpcMainEvent) =>");
      expect(output).toContain("if (!guard(_event)) {");
      expect(output).toContain("return _callback(_event, callback, event);");
   });

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
            "handle: (callback: (event: IpcMainInvokeEvent, id: number) => Promise<string>)",
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
      expect(output).toContain("electronIpcMain.handle('clashIt', _listener);");
      expect(output).toContain("if (registeredHandlers['clashIt'] === _listener) {");
   });

   it("should declare the handler registry only for invoke channels", async () => {
      const render = async (...channels: shared.SimpleChannel[]) => {
         const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels));
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };
      const unicast = { name: "getIt", kind: "Unicast", direction: "RendererToMain" } as const;
      const broadcast = { name: "sendIt", kind: "Broadcast", direction: "RendererToMain" } as const;

      expect(await render(unicast)).toContain("const registeredHandlers");
      expect(await render(broadcast)).not.toContain("registeredHandlers");
      expect(await render(broadcast)).not.toContain("removeHandler");
   });

   it("should write an immediate sender and a separate binder for triggered channels", async () => {
      // Regression for B5: the sender used to register a window listener on every call.
      const pfsArray = shared.buildFileSpecs({
         name: "focused",
         kind: "Broadcast",
         direction: "MainToRenderer",
         params: ["state: boolean", "...tags: string[]"],
         trigger: "focus",
      });
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { webContents as electronWebContents } from "electron";
         import type { BrowserWindow, WebContents, WebContentsView, WebFrameMain } from "electron";

         function resolveSendTarget(
            target: BrowserWindow | WebContents | WebContentsView | WebFrameMain,
         ): WebContents | WebFrameMain {
            return 'webContents' in target ? target.webContents : target;
         }

         function broadcastMessage(
            channel: string,
            args: unknown[],
            filter?: (contents: WebContents) => boolean,
         ): void {
            for (const contents of electronWebContents.getAllWebContents()) {
               if (!contents.isDestroyed() && (!filter || filter(contents))) {
                  contents.send(channel, ...args);
               }
            }
         }

         function sendToSenderFrame(
            event: { readonly senderFrame: WebFrameMain | null },
            channel: string,
            args: unknown[],
         ): boolean {
            let frame: WebFrameMain | null = null;
            try {
               frame = event.senderFrame;
               if (frame && (frame.isDestroyed?.() || frame.detached)) {
                  frame = null;
               }
            } catch {
               frame = null;
            }
            if (!frame) {
               return false;
            }
            frame.send(channel, ...args);
            return true;
         }

         export const ipc = {
            focused: {
               send: (target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, state: boolean, ...tags: string[]) =>
                  resolveSendTarget(target).send('focused', state, ...tags),
               sendToSender: (event: { readonly senderFrame: WebFrameMain | null }, state: boolean, ...tags: string[]) =>
                  sendToSenderFrame(event, 'focused', [state, ...tags]),
               broadcast: (state: boolean, ...tags: string[]) =>
                  broadcastMessage('focused', [state, ...tags]),
               broadcastTo: (filter: (contents: WebContents) => boolean, state: boolean, ...tags: string[]) =>
                  broadcastMessage('focused', [state, ...tags], filter),
               bind: (browserWindow: BrowserWindow, provider: () => [state: boolean, ...tags: string[]] | Promise<[state: boolean, ...tags: string[]]>, onError?: (error: unknown) => void) => {
                  const listener = async () => {
                     try {
                        const args = await provider();
                        if (!browserWindow.isDestroyed()) {
                           browserWindow.webContents.send('focused', ...args);
                        }
                     } catch (error) {
                        (onError ?? console.error)(error);
                     }
                  };
                  browserWindow.on("focus", listener);
                  return () => {
                     browserWindow.off("focus", listener);
                  };
               },
            },
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   it("should write a connect method for Port channels, which pairs the windows once they have loaded", async () => {
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { ipcMain as electronIpcMain, MessageChannelMain } from "electron";
         import type { BrowserWindow, IpcMainEvent, WebContents } from "electron";

         let lastPortConnectionId = 0;
         const portEnds = new Map<string, { contents: WebContents; close: () => void }>();
         const portDisconnectChannels = new Set<string>();

         function listenForPortDisconnects(channel: string): void {
            if (portDisconnectChannels.has(channel)) {
               return;
            }
            portDisconnectChannels.add(channel);
            electronIpcMain.on(\`\${channel}:disconnect\`, (event: IpcMainEvent, key: unknown) => {
               const end = typeof key === 'string' ? portEnds.get(key) : undefined;
               if (end && !end.contents.isDestroyed() && end.contents === event.sender) {
                  end.close();
               }
            });
         }

         interface PageLoadWatch {
            isLoaded: () => boolean;
            dispose: () => void;
         }

         function watchPageLoad(contents: WebContents, onLoad: () => void): PageLoadWatch {
            let loaded = !contents.isDestroyed() && !contents.isLoading() && contents.getURL() !== '';
            // Whether the load that is going on has been reported already.
            let settled = !contents.isDestroyed() && !contents.isLoading();
            let failed = false;
            const start = (details?: { isMainFrame?: boolean; isSameDocument?: boolean }) => {
               if (details?.isMainFrame && !details.isSameDocument) {
                  loaded = false;
                  settled = false;
                  failed = false;
               }
            };
            const fail = (_event: unknown, _code: number, _description: string, _url: string, isMainFrame: boolean) => {
               if (isMainFrame) {
                  failed = true;
               }
            };
            const finish = () => {
               loaded = true;
               settled = true;
               onLoad();
            };
            const stop = () => {
               if (!settled && !failed) {
                  finish();
               }
            };
            contents.on('did-start-navigation', start);
            contents.on('did-fail-load', fail);
            contents.on('did-finish-load', finish);
            contents.on('did-stop-loading', stop);
            return {
               isLoaded: () => loaded,
               dispose: () => {
                  // Destroyed contents have dropped their listeners, and cannot be reached.
                  if (!contents.isDestroyed()) {
                     contents.off('did-start-navigation', start);
                     contents.off('did-fail-load', fail);
                     contents.off('did-finish-load', finish);
                     contents.off('did-stop-loading', stop);
                  }
               },
            };
         }

         function connectPorts(channel: string, winA: BrowserWindow, winB: BrowserWindow): { close: () => void } {
            const id = ++lastPortConnectionId;
            // Both windows are resolved before anything is registered: the getter of a destroyed window throws.
            const ends = [
               { key: \`\${id}:a\`, win: winA, contents: winA.webContents },
               { key: \`\${id}:b\`, win: winB, contents: winB.webContents },
            ];
            const watched = winA === winB ? [ends[0]] : ends;
            let closed = false;
            const watches = new Map<BrowserWindow, PageLoadWatch>();
            const isReady = (win: BrowserWindow) => !win.isDestroyed() && !!watches.get(win)?.isLoaded();
            const pair = () => {
               if (closed || !isReady(winA) || !isReady(winB)) {
                  return;
               }
               const { port1, port2 } = new MessageChannelMain();
               ends[0].contents.postMessage(channel, ends[0].key, [port1]);
               ends[1].contents.postMessage(channel, ends[1].key, [port2]);
            };
            const close = () => {
               if (closed) {
                  return;
               }
               closed = true;
               for (const end of watched) {
                  // A destroyed window has dropped its listeners, and cannot be reached.
                  if (!end.win.isDestroyed()) {
                     end.win.off('closed', close);
                  }
                  watches.get(end.win)?.dispose();
               }
               for (const end of ends) {
                  portEnds.delete(end.key);
                  if (!end.win.isDestroyed()) {
                     end.contents.send(\`\${channel}:close\`, end.key);
                  }
               }
            };
            // A failure from here on undoes what was registered, since the caller never gets the handle.
            try {
               for (const end of ends) {
                  portEnds.set(end.key, { contents: end.contents, close });
               }
               listenForPortDisconnects(channel);
               for (const end of watched) {
                  end.win.on('closed', close);
                  watches.set(end.win, watchPageLoad(end.contents, pair));
               }
               pair();
            } catch (error) {
               close();
               throw error;
            }
            return { close };
         }

         export const ipc = {
            vitestChannel: {
               connect: (winA: BrowserWindow, winB: BrowserWindow) => connectPorts('vitestChannel', winA, winB),
            },
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
   });

   describe("mainPort channels", () => {
      const render = async (...channels: shared.SimpleChannel[]) => {
         const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels));
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };
      const mainPort = { name: "tail", kind: "Port", direction: "MainToRenderer" } as const;
      const port = { name: "chat", kind: "Port", direction: "RendererToRenderer" } as const;

      it("should write a typed connect method which returns the connection of one contents", async () => {
         const pfsArray = shared.vitestChannelSpecs.Port_MainToRenderer;
         const obj = new shared.VitestMainBindingsWriter(pfsArray);
         await obj.write(false);
         const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

         expect(output).toContain(
            'import { ipcMain as electronIpcMain, MessageChannelMain } from "electron";',
         );
         expect(output).toContain(
            'import type { BrowserWindow, IpcMainEvent, WebContents, WebContentsView, MessagePortMain } from "electron";',
         );
         expect(output).toContain(
            "connect: (target: BrowserWindow | WebContents | WebContentsView): " +
               "{ send: (arg1: string, arg2: string) => void; " +
               "on: (callback: (arg1: string, arg2: string) => void) => () => void; " +
               "onReady: (callback: () => void) => () => void; " +
               "onClose: (callback: () => void) => () => void; " +
               "onOverflow: (callback: ((queue: Parameters<(arg1: string, arg2: string) => void>[], message: Parameters<(arg1: string, arg2: string) => void>, info: PortOverflowInfo) => Parameters<(arg1: string, arg2: string) => void>[]) | undefined) => () => void; " +
               "close: () => void } => connectMainPort('vitestChannel', 'vitestChannel', 1000, target),",
         );
         // The helper for two windows is not there.
         expect(output).not.toContain("connectPorts");
      });

      it("should keep the main end of a MessageChannelMain, and give the page the other", async () => {
         const output = await render(mainPort);

         expect(output).toContain("const { port1, port2 } = new MessageChannelMain();");
         expect(output).toContain("attach(port1);");
         expect(output).toContain("contents.postMessage(channel, key, [port2]);");
         expect(output).toContain("next.on('message', (event: { data: unknown }) => {");
         expect(output).toContain("next.on('close', () => {");
         expect(output).toContain("next.start();");
         expect(output).toContain("next.postMessage(args);");
         expect(output).toContain("const watch = watchPageLoad(contents, () => pair());");
         expect(output).toContain(
            "const isReady = () => !contents.isDestroyed() && watch.isLoaded();",
         );
         expect(output).toContain("watch.dispose();");
         // The page counts as loaded from the event, since `isLoading()` is still true then.
         expect(output.slice(output.indexOf("function connectMainPort"))).not.toContain(
            "isLoading",
         );
         expect(output).toContain("contents.send(`${channel}:close`, key);");
      });

      it("should end the connection when the contents are destroyed or the page asks for it", async () => {
         const output = await render(mainPort);

         expect(output).toContain("contents.on('destroyed', close);");
         expect(output).toContain("portEnds.set(key, { contents, close });");
         expect(output).toContain("listenForPortDisconnects(channel);");
      });

      it("should send the messages in order once the port is there, never before", async () => {
         const output = await render(mainPort);

         expect(output).toContain(
            "enqueueMainPort(pending, args, name, max, ownOverflow ?? portsConfig.onOverflow);",
         );
         expect(output).toContain("for (const args of pending.items.splice(0)) {");
      });

      it("should declare only the helpers that the port channels use", async () => {
         const onlyMain = await render(mainPort);
         const onlyRenderers = await render(port);
         const both = await render(mainPort, port);

         expect(onlyMain).toContain("function connectMainPort(");
         expect(onlyMain).not.toContain("function connectPorts(");
         expect(onlyRenderers).toContain("function connectPorts(");
         expect(onlyRenderers).not.toContain("connectMainPort");
         expect(onlyRenderers).not.toContain("MessagePortMain");
         expect(both).toContain("function connectMainPort(");
         expect(both).toContain("function connectPorts(");
         // The registry of the ends is shared, so it is declared once.
         expect(both.match(/const portEnds = /g)).toHaveLength(1);
      });

      it("should reserve the names that the helpers declare, so that schema types are renamed", () => {
         const generator = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(mainPort));
         const names = (
            generator as unknown as { getReservedNames(): string[] }
         ).getReservedNames();

         for (const name of [
            "connectMainPort",
            "configurePorts",
            "PortOverflowInfo",
            "PortsConfig",
            "MainPortConnection",
            "MainPortListener",
            "MessagePortMain",
            "Map",
            "Set",
            "Function",
         ]) {
            expect(names).toContain(name);
         }
      });

      it("should pass the maxQueue of the channel to the connection, and the default of 1000 without one", async () => {
         const output = await render(
            { ...mainPort, name: "bounded", maxQueue: 5 },
            { ...mainPort, name: "none", maxQueue: 0 },
            { ...mainPort, name: "unbounded", maxQueue: Number.POSITIVE_INFINITY },
            { ...mainPort, name: "plain" },
         );

         expect(output).toContain("connectMainPort('bounded', 'bounded', 5, target)");
         expect(output).toContain("connectMainPort('none', 'none', 0, target)");
         expect(output).toContain("connectMainPort('unbounded', 'unbounded', Infinity, target)");
         expect(output).toContain("connectMainPort('plain', 'plain', 1000, target)");
      });

      it("should declare configurePorts and the overflow types only for mainPort channels", async () => {
         const onlyMain = await render(mainPort);
         const onlyRenderers = await render(port);

         expect(onlyMain).toContain("export function configurePorts(config: PortsConfig): void {");
         expect(onlyMain).toContain("export interface PortOverflowInfo {");
         expect(onlyMain).toContain("function enqueueMainPort(");
         expect(onlyRenderers).not.toContain("configurePorts");
         expect(onlyRenderers).not.toContain("PortOverflowInfo");
         expect(onlyRenderers).not.toContain("enqueueMainPort");
      });

      it("should type the overflow callback of a connection with the parameters of the signature", async () => {
         const output = await render({ ...mainPort, params: ["line: string", "level?: number"] });

         expect(output).toContain(
            "onOverflow: (callback: ((queue: Parameters<(line: string, level?: number) => void>[], " +
               "message: Parameters<(line: string, level?: number) => void>, info: PortOverflowInfo) " +
               "=> Parameters<(line: string, level?: number) => void>[]) | undefined) => () => void;",
         );
      });

      it("should put the prefix in front of the name that is passed to Electron", async () => {
         const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(mainPort), {
            channelPrefix: "app:",
         });
         await obj.write(false);
         const output = (await fsp.readFile(obj.getTargetFilePath())).toString();

         expect(output).toContain("connectMainPort('app:tail', 'tail', 1000, target)");
      });
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
         expect(output).toContain("electronIpcMain.handle('getIt', listener);");
         expect(output).toContain("registeredHandlers['getIt'] = listener;");
      });

      it("registers the wrapper, not the inner handler, so the disposer compares the right function", async () => {
         const output = await render([unicast]);

         expect(output).toContain("if (registeredHandlers['getIt'] === listener) {");
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

         expect(output).toContain("electronIpcMain.on('sendIt', listener);");
         expect(output.match(/settleInvoke\(\(\) =>/g)).toHaveLength(2);
      });

      it("registers the plain listener of an invoke channel when rawErrors is set", async () => {
         const output = await render([unicast], { rawErrors: true });

         expect(output).not.toContain("settleInvoke");
         expect(output).not.toContain("toIpcError");
         expect(output).toContain("const listener = (event: IpcMainInvokeEvent) => {");
         expect(output).toContain("electronIpcMain.handle('getIt', listener);");
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

         expect(output).toContain("electronIpcMain.handle('app:getIt', listener);");
         expect(output).toContain("electronIpcMain.removeHandler('app:getIt');");
         expect(output).toContain("electronIpcMain.on('app:sendIt', listener);");
         expect(output).toContain("electronIpcMain.off('app:sendIt', listener);");
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
         expect(output).toContain("registeredHandlers['getIt'] = listener;");
         expect(output).not.toMatch(/'app:(getIt|sendIt)'\)\)/);
         expect(output).not.toContain("registeredHandlers['app:");
      });

      it("writes the names as they are without a prefix, and when the config has none", async () => {
         const bare = await render({ channelPrefix: "" });

         expect(bare).toContain("electronIpcMain.handle('getIt', listener);");
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

   describe("ask channels", () => {
      const ask = {
         name: "askIt",
         kind: "Unicast",
         direction: "MainToRenderer",
         params: ["id: number"],
         returnType: "boolean",
      } as const;
      const askAsync = {
         name: "askLater",
         kind: "Unicast",
         direction: "MainToRenderer",
         returnType: "Promise<string>",
      } as const;
      const emit = { name: "pushIt", kind: "Broadcast", direction: "MainToRenderer" } as const;
      const unicast = { name: "getIt", kind: "Unicast", direction: "RendererToMain" } as const;
      const render = async (
         channels: Parameters<typeof shared.buildFileSpecs>,
         config: Partial<t.IPCResolvedConfig> = {},
      ) => {
         const obj = new shared.VitestMainBindingsWriter(
            shared.buildFileSpecs(...channels),
            config,
         );
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      it("generates invoke and invokeWith, which share one helper", async () => {
         const output = await render([ask, askAsync]);

         expect(output).toContain(
            "invoke: (target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, id: number): Promise<Awaited<boolean>> =>",
         );
         expect(output).toContain(
            "askRenderer('askIt', 'askIt', 'askIt:reply', target, [id]) as Promise<Awaited<boolean>>,",
         );
         expect(output).toContain(
            "invokeWith: (target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, options: IpcAskOptions, id: number): Promise<Awaited<boolean>> =>",
         );
         expect(output).toContain(
            "askRenderer('askIt', 'askIt', 'askIt:reply', target, [id], options) as Promise<Awaited<boolean>>,",
         );
         expect(output).toContain("export class IpcAskError extends Error {");
         expect(output).toContain("export interface IpcAskOptions {");
         expect(output.match(/^function askRenderer\(/gm)).toHaveLength(1);
      });

      it("does not wrap the promise of an async signature again", async () => {
         const output = await render([askAsync]);

         expect(output).toContain(
            "invoke: (target: BrowserWindow | WebContents | WebContentsView | WebFrameMain): Promise<string> =>",
         );
         expect(output).toContain("target, []) as Promise<string>,");
      });

      it("imports ipcMain and the types of the reply listener, and no sender validation", async () => {
         const output = await render([ask]);

         expect(output).toContain(
            'import { ipcMain as electronIpcMain, webContents as electronWebContents } from "electron";',
         );
         expect(output).toContain(
            'import type { BrowserWindow, WebContents, WebContentsView, WebFrameMain, IpcMainEvent } from "electron";',
         );
         expect(output).not.toContain("isSenderAllowed");
         expect(output).not.toContain("IpcForbiddenError");
         expect(output).not.toContain("registeredHandlers");
         expect(output).not.toContain("settleInvoke");
      });

      it("declares broadcastMessage and sendToSenderFrame for an emit only", async () => {
         const asks = await render([ask]);
         const emits = await render([emit]);
         const both = await render([ask, emit]);

         expect(asks).toContain("function resolveSendTarget(");
         expect(asks).not.toContain("function broadcastMessage(");
         expect(asks).not.toContain("function sendToSenderFrame(");
         expect(emits).not.toContain("askRenderer");
         expect(emits).not.toContain("IpcAskError");
         expect(emits).toContain("function broadcastMessage(");
         expect(emits).toContain("function sendToSenderFrame(");
         expect(both).toContain("function broadcastMessage(");
         expect(both).toContain("function askRenderer(");
         expect(both.match(/^function resolveSendTarget\(/gm)).toHaveLength(1);
      });

      it("keeps the envelope and the reply listener of the other channels", async () => {
         const output = await render([ask, unicast]);

         expect(output).toContain("function settleInvoke(");
         expect(output).toContain("function isSenderAllowed(");
         expect(output).toContain("function listenForAskReplies(");
         expect(output.match(/import \{ ipcMain as electronIpcMain/g)).toHaveLength(1);
      });

      it("is not changed by rawErrors, since the reply is always an envelope", async () => {
         expect(await render([ask], { rawErrors: true })).toBe(await render([ask]));
      });

      it("puts the prefix in front of the request and the reply channel only", async () => {
         const output = await render([ask], { channelPrefix: "app:" });

         expect(output).toContain(
            "askRenderer('askIt', 'app:askIt', 'app:askIt:reply', target, [id])",
         );
         expect(output).not.toContain("'app:askIt:reply:");
         const bare = await render([ask], { channelPrefix: "" });
         expect(bare).toContain("askRenderer('askIt', 'askIt', 'askIt:reply', target, [id])");
         expect(await render([ask], {})).toBe(bare);
      });
   });
   describe("stream channels", () => {
      const rows = {
         name: "exportRows",
         kind: "Stream",
         direction: "RendererToMain",
         params: ["table: string", "limit?: number"],
         returnType: "AsyncIterable<Row>",
      } as const;
      const tokens = {
         name: "tokens",
         kind: "Stream",
         direction: "RendererToMain",
         returnType: "AsyncGenerator<string, void, undefined>",
      } as const;
      const invoke = {
         name: "getIt",
         kind: "Unicast",
         direction: "RendererToMain",
         returnType: "Promise<string>",
      } as const;
      const render = async (
         channels: Parameters<typeof shared.buildFileSpecs>,
         config: Partial<t.IPCResolvedConfig> = {},
      ) => {
         const obj = new shared.VitestMainBindingsWriter(
            shared.buildFileSpecs(...channels),
            config,
         );
         await obj.write(false);
         return (await fsp.readFile(obj.getTargetFilePath())).toString();
      };

      it("generates handle only, which takes an async generator and gets the event first", async () => {
         const output = await render([rows]);

         expect(output).toContain(
            "handle: (callback: (event: IpcMainInvokeEvent, table: string, limit?: number) => AsyncIterable<Row>) => {",
         );
         expect(output).not.toContain("handleOnce");
         expect(output).toContain("electronIpcMain.handle('exportRows', listener);");
         expect(output).toContain("registeredHandlers['exportRows'] = listener;");
         expect(output).toContain("electronIpcMain.removeHandler('exportRows');");
      });

      it("keeps the type of an AsyncGenerator return as written", async () => {
         const output = await render([tokens]);

         expect(output).toContain(
            "handle: (callback: (event: IpcMainInvokeEvent) => AsyncGenerator<string, void, undefined>) => {",
         );
      });

      it("takes the stream ID as the first argument after the event, and starts the stream", async () => {
         const output = await render([rows]);

         expect(output).toContain(
            "const listener = (event: IpcMainInvokeEvent, id: unknown, ...rest: unknown[]) =>",
         );
         expect(output).toContain(
            "settleInvoke(() => startStream(event, 'exportRows', 'exportRows', id, () => (handler as (...rest: unknown[]) => unknown)(event, ...rest)));",
         );
      });

      it("declares the stream helper once, and the electron imports it needs", async () => {
         const output = await render([rows, tokens]);

         expect(output.match(/^async function startStream\(/gm)).toHaveLength(1);
         expect(output.match(/^function stopIterator\(/gm)).toHaveLength(1);
         expect(output).toContain(
            'import { ipcMain as electronIpcMain, MessageChannelMain } from "electron";',
         );
         expect(output).toContain(
            'import type { IpcMainInvokeEvent, MessagePortMain, WebContents, WebFrameMain } from "electron";',
         );
      });

      it("hands the port to the sender frame, falls back to the contents and sends in order", async () => {
         const output = await render([rows]);

         expect(output).toContain("const { port1, port2 } = new MessageChannelMain();");
         expect(output).toContain("let target: WebContents | WebFrameMain = event.sender;");
         expect(output).toContain("target.postMessage(`${wire}:port`, id, [port2]);");
         expect(output).toContain("port1.postMessage({ type: 'chunk', value: step.value });");
         expect(output).toContain("port1.postMessage({ type: 'end' });");
         expect(output).toContain("port1.postMessage({ type: 'error', error });");
      });

      it("cancels on a cancel message, a closed port and destroyed contents", async () => {
         const output = await render([rows]);

         expect(output).toContain("if (data && data.type === 'cancel') {");
         expect(output).toContain("port1.on('close', cancel);");
         expect(output).toContain("sender.once('destroyed', cancel);");
         expect(output).toContain("Promise.resolve(iterator.return?.())");
      });

      it("reports a chunk which cannot be sent, and a handler which returns no async iterable", async () => {
         const output = await render([rows]);

         expect(output).toContain("code: 'IPC_STREAM_UNSENDABLE'");
         expect(output).toContain("code: 'IPC_STREAM_NOT_ITERABLE'");
         expect(output).toContain("code: 'IPC_STREAM_INVALID_REQUEST'");
      });

      it("uses the sender checks and the envelope of the invoke channels", async () => {
         const output = await render([rows]);

         expect(output).toContain("function isSenderAllowed(");
         expect(output).toContain("function settleInvoke(");
         expect(output).toContain("function toIpcError(");
         expect(output).toContain("if (!isSenderAllowed(event, 'exportRows')) {");
         expect(output).toContain("throw new IpcForbiddenError('exportRows');");
      });

      it("puts the allowed origins and the validator in front of the handler", async () => {
         const output = await render([
            {
               ...rows,
               allowedOrigins: ["app://."],
               validate: { name: "tableArgs", exported: "tableArgs", fromPath: "./v" },
            },
         ]);

         expect(output).toContain("isSenderAllowed(event, 'exportRows', [\"app://.\"])");
         expect(output).toContain("validateArguments(event, 'exportRows', tableArgs, ");
         expect(output).toContain("function validateArguments<R>(");
      });

      it("always uses the envelope, whatever rawErrors says", async () => {
         const raw = await render([rows], { rawErrors: true });

         expect(raw).toBe(await render([rows]));
         expect(raw).toContain("settleInvoke(() => startStream(");
         expect(await render([invoke], { rawErrors: true })).not.toContain("settleInvoke");
      });

      it("leaves the invoke channels next to it as they are", async () => {
         const both = await render([rows, invoke]);

         expect(both).toContain(
            "handleOnce: (callback: (event: IpcMainInvokeEvent) => Promise<string>)",
         );
         expect(both).toContain(
            "const listener = (event: IpcMainInvokeEvent, ...rest: unknown[]) =>",
         );
         expect(both.match(/import \{ ipcMain as electronIpcMain/g)).toHaveLength(1);
      });

      it("puts the prefix in front of the request and the port channel", async () => {
         const output = await render([rows], { channelPrefix: "app:" });

         expect(output).toContain("electronIpcMain.handle('app:exportRows', listener);");
         expect(output).toContain("startStream(event, 'exportRows', 'app:exportRows', id, ");
         const bare = await render([rows], { channelPrefix: "" });
         expect(bare).toContain("startStream(event, 'exportRows', 'exportRows', id, ");
         expect(await render([rows], {})).toBe(bare);
      });

      it("names the generated variables apart from the parameters of the signature", async () => {
         const output = await render([
            {
               name: "clash",
               kind: "Stream",
               direction: "RendererToMain",
               params: ["event: string", "id: number", "rest: boolean", "handler: string"],
               returnType: "AsyncIterable<string>",
            },
         ]);

         expect(output).toContain(
            "const listener = (_event: IpcMainInvokeEvent, _id: unknown, ..._rest: unknown[]) =>",
         );
         expect(output).toContain(
            "startStream(_event, 'clash', 'clash', _id, () => (_handler as (..._rest: unknown[]) => unknown)(_event, ..._rest))",
         );
      });

      it("generates nothing of streams for the other channels", async () => {
         const output = await render([invoke]);

         expect(output).not.toContain("startStream");
         expect(output).not.toContain("stopIterator");
         expect(output).not.toContain("MessageChannelMain");
         expect(output).not.toContain("MessagePortMain");
      });
   });
});

describe("MainBindingsWriter, utility channels", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);

   const callUtility = { name: "indexFile", kind: "Unicast", direction: "MainToUtility" } as const;
   const notifyUtility = {
      name: "setLevel",
      kind: "Broadcast",
      direction: "MainToUtility",
   } as const;
   const callMain = { name: "getSetting", kind: "Unicast", direction: "UtilityToMain" } as const;
   const notifyMain = { name: "progress", kind: "Broadcast", direction: "UtilityToMain" } as const;
   const renderer = { name: "getUser", kind: "Unicast", direction: "RendererToMain" } as const;

   const render = async (
      channels: shared.SimpleChannel[],
      config: Partial<t.IPCResolvedConfig> = {},
   ) => {
      const writer = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels), {
         channelPrefix: "autoipc:",
         ...config,
      });
      await writer.write(false);
      return (await fsp.readFile(writer.getTargetFilePath())).toString();
   };

   it("writes nothing of the utility protocol for a schema without such channels", async () => {
      const output = await render([renderer]);

      for (const name of ["UtilityProcess", "IpcUtilityError", "attachUtility", "WeakMap"]) {
         expect(output).not.toContain(name);
      }
   });

   it("imports nothing but the type of the child when only utility channels are declared", async () => {
      const output = await render([callUtility, callMain]);

      expect(output).toContain('import type { UtilityProcess } from "electron";');
      expect(output).not.toContain("ipcMain");
      expect(output).not.toContain("IpcForbiddenError");
      expect(output).toContain("async function settleInvoke(");
   });

   it("writes the envelope once when renderer and utility channels share the file", async () => {
      const output = await render([renderer, callUtility]);

      expect(output.split("function toIpcError(").length).toBe(2);
      expect(output).toContain(
         'import type { IpcMainInvokeEvent, UtilityProcess } from "electron";',
      );
   });

   it("writes the peer of a child, and attachUtility", async () => {
      const output = await render([callUtility]);

      expect(output).toContain("const utilityPeers = new WeakMap<UtilityProcess, UtilityPeer>();");
      expect(output).toContain(
         "child.on('message', (message: unknown) => receiveUtilityMessage(peer, message));",
      );
      expect(output).toContain(
         "child.once('exit', () => closeUtilityPeer(peer, 'The utility process exited'));",
      );
      expect(output).toContain("export function attachUtility(child: UtilityProcess): void {");
   });

   it("writes invoke for calls to the child, with the child first", async () => {
      const output = await render([
         {
            ...callUtility,
            params: ["path: string", "...tags: string[]"],
            returnType: "Promise<number>",
         },
         { ...callUtility, name: "plain", returnType: "number" },
      ]);

      expect(output).toContain(
         [
            "   indexFile: {",
            "      invoke: (child: UtilityProcess, path: string, ...tags: string[]): Promise<number> =>",
            "         callUtilityPeer(getUtilityPeer(child), 'autoipc:indexFile', [path, ...tags]) as Promise<number>,",
            "   },",
         ].join("\n"),
      );
      expect(output).toContain(
         "invoke: (child: UtilityProcess): Promise<Awaited<number>> =>\n         callUtilityPeer(getUtilityPeer(child), 'autoipc:plain', []) as Promise<Awaited<number>>,",
      );
   });

   it("writes send for notifications to the child", async () => {
      const output = await render([{ ...notifyUtility, params: ["level: string"] }]);

      expect(output).toContain(
         [
            "   setLevel: {",
            "      send: (child: UtilityProcess, level: string): void =>",
            "         sendUtilityPeer(getUtilityPeer(child), 'autoipc:setLevel', [level]),",
            "   },",
         ].join("\n"),
      );
   });

   it("writes handle per child for calls of the child", async () => {
      const output = await render([{ ...callMain, params: ["key: string"], returnType: "string" }]);

      expect(output).toContain(
         [
            "   getSetting: {",
            "      handle: (child: UtilityProcess, callback: (key: string) => string) =>",
            "         setUtilityHandler(getUtilityPeer(child), 'autoipc:getSetting', callback),",
            "   },",
         ].join("\n"),
      );
   });

   it("writes on and once per child for notifications of the child", async () => {
      const output = await render([{ ...notifyMain, params: ["done: number"] }]);

      expect(output).toContain(
         [
            "   progress: {",
            "      on: (child: UtilityProcess, callback: (done: number) => void) =>",
            "         addUtilityListener(getUtilityPeer(child), 'autoipc:progress', callback, false),",
            "      once: (child: UtilityProcess, callback: (done: number) => void) =>",
            "         addUtilityListener(getUtilityPeer(child), 'autoipc:progress', callback, true),",
            "   },",
         ].join("\n"),
      );
   });

   it("does not let the generated names shadow the names of the signature", async () => {
      const output = await render([
         { ...callUtility, params: ["child: string"], returnType: "typeof child" },
         { ...callMain, params: ["callback: string", "child: number"] },
      ]);

      expect(output).toContain("invoke: (_child: UtilityProcess, child: string)");
      expect(output).toContain("getUtilityPeer(_child), 'autoipc:indexFile', [child]");
      expect(output).toContain(
         "handle: (_child: UtilityProcess, _callback: (callback: string, child: number)",
      );
   });

   it("reserves the names it declares, only when the schema has utility channels", () => {
      const reserved = (...channels: shared.SimpleChannel[]) =>
         (
            new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels)) as unknown as {
               getReservedNames: () => string[];
            }
         ).getReservedNames();

      for (const name of [
         "IpcUtilityError",
         "UtilityPeer",
         "attachUtility",
         "UtilityProcess",
         "WeakMap",
      ]) {
         expect(reserved(callUtility)).toContain(name);
         expect(reserved(renderer)).not.toContain(name);
      }
   });
});
