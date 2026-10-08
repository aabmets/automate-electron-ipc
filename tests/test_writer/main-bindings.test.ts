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
                  const listener = (event: IpcMainInvokeEvent, arg1: CustomType, arg2?: CustomType) => {
                     guard(event);
                     return callback(event, arg1, arg2);
                  };
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
                  const listener = (event: IpcMainInvokeEvent, arg1: CustomType, arg2?: CustomType) => {
                     guard(event);
                     remove();
                     return callback(event, arg1, arg2);
                  };
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
         import type { BrowserWindow } from "electron";
         
         export const ipc = {
            vitestChannel: {
               send: (browserWindow: BrowserWindow, arg1: number, ...arg2: number[]) =>
                  browserWindow.webContents.send('vitestChannel', arg1, ...arg2),
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
      expect(output).toContain("const listener = (event: IpcMainInvokeEvent) => {");
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
            "const listener = (event: IpcMainInvokeEvent, ...received: unknown[]) => {",
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
         const listener = /const listener = \((.*)\) => \{\n([\s\S]*?)\n\s+\};/.exec(output);
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

      expect(output).toContain("const _listener = (event: IpcMainInvokeEvent, listener: string)");
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
         import type { BrowserWindow } from "electron";

         export const ipc = {
            focused: {
               send: (browserWindow: BrowserWindow, state: boolean, ...tags: string[]) =>
                  browserWindow.webContents.send('focused', state, ...tags),
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

   it("should write a connect method for Port channels", async () => {
      const pfsArray = shared.vitestChannelSpecs.Port_RendererToRenderer;
      const obj = new shared.VitestMainBindingsWriter(pfsArray);
      await obj.write(false);
      const buffer = await fsp.readFile(obj.getTargetFilePath());
      const expectedOutput = utils.dedent(`
         import { MessageChannelMain } from "electron";
         import type { BrowserWindow } from "electron";

         export const ipc = {
            vitestChannel: {
               connect: (winA: BrowserWindow, winB: BrowserWindow) => {
                  const { port1, port2 } = new MessageChannelMain();
                  winA.once('ready-to-show', () => {
                     winA.webContents.postMessage('vitestChannel', null, [port1]);
                  });
                  winB.once('ready-to-show', () => {
                     winB.webContents.postMessage('vitestChannel', null, [port2]);
                  });
               },
            },
         }
      `);
      expect(buffer.toString()).toStrictEqual(expectedOutput.trimStart());
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

   it("should import ipcMain from electron only for RendererToMain channels", async () => {
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
      expect(toRenderer.startsWith('import type { BrowserWindow } from "electron";')).toBe(true);
      expect(port).not.toContain("electronIpcMain");
      expect(port.startsWith('import { MessageChannelMain } from "electron";')).toBe(true);
      expect(toMain.startsWith('import { ipcMain as electronIpcMain } from "electron";')).toBe(
         true,
      );
      expect(
         both.startsWith("import { ipcMain as electronIpcMain, MessageChannelMain } from"),
      ).toBe(true);
   });
});
