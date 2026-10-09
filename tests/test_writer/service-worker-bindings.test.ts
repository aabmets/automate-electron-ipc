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

const invokeFromWorker = {
   name: "getToken",
   kind: "Unicast",
   direction: "ServiceWorkerToMain",
} as const;
const sendFromWorker = {
   name: "syncDone",
   kind: "Broadcast",
   direction: "ServiceWorkerToMain",
} as const;
const askWorker = { name: "flush", kind: "Unicast", direction: "MainToServiceWorker" } as const;
const emitToWorker = {
   name: "configChanged",
   kind: "Broadcast",
   direction: "MainToServiceWorker",
} as const;
const renderer = { name: "getUser", kind: "Unicast", direction: "RendererToMain" } as const;
const all = [invokeFromWorker, sendFromWorker, askWorker, emitToWorker];

describe("MainBindingsWriter, service worker channels", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);

   const render = async (
      channels: shared.SimpleChannel[],
      config: Partial<t.IPCResolvedConfig> = {},
   ) => {
      const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(...channels), {
         channelPrefix: "autoipc:",
         ...config,
      });
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };

   it("writes nothing for the workers when the schema has no such channel", async () => {
      const output = await render([renderer]);
      for (const name of [
         "attachServiceWorkers",
         "IpcWorkerError",
         "configureServiceWorkerIpc",
         "ServiceWorkerMain",
         "Session",
      ]) {
         expect(output).not.toContain(name);
      }
   });

   it("imports only the electron types that the channels use", async () => {
      const calls = await render([{ ...invokeFromWorker, params: ["a: string"] }]);
      expect(calls).toContain(
         'import type { Session, ServiceWorkerMain, IpcMainServiceWorkerInvokeEvent } from "electron";',
      );
      expect(calls).not.toContain("IpcMainServiceWorkerEvent");
      const sends = await render([sendFromWorker]);
      expect(sends).toContain(
         'import type { Session, ServiceWorkerMain, IpcMainServiceWorkerEvent } from "electron";',
      );
      expect(sends).not.toContain("IpcMainServiceWorkerInvokeEvent");
      const toWorker = await render([emitToWorker]);
      expect(toWorker).toContain('import type { Session, ServiceWorkerMain } from "electron";');
      expect(toWorker).not.toContain("IpcMainServiceWorker");
      expect(toWorker).not.toContain("configureServiceWorkerIpc");
   });

   it("writes handle and handleOnce with the event of a service worker first", async () => {
      const output = await render([
         {
            ...invokeFromWorker,
            params: ["scope: string", "force?: boolean"],
            returnType: "string",
         },
      ]);

      expect(output).toContain(
         [
            "   getToken: {",
            "      handle: (session: Session, callback: (event: IpcMainServiceWorkerInvokeEvent, scope: string, force?: boolean) => string): (() => void) =>",
            "         registerWorkerHandler(session, 'getToken', callback, false),",
            "      handleOnce: (session: Session, callback: (event: IpcMainServiceWorkerInvokeEvent, scope: string, force?: boolean) => string): (() => void) =>",
            "         registerWorkerHandler(session, 'getToken', callback, true),",
            "   },",
         ].join("\n"),
      );
   });

   it("writes on and once for a message of a worker", async () => {
      const output = await render([{ ...sendFromWorker, params: ["n: number"] }]);

      expect(output).toContain(
         [
            "   syncDone: {",
            "      on: (session: Session, callback: (event: IpcMainServiceWorkerEvent, n: number) => void): (() => void) =>",
            "         addWorkerListener(session, 'syncDone', callback, false),",
            "      once: (session: Session, callback: (event: IpcMainServiceWorkerEvent, n: number) => void): (() => void) =>",
            "         addWorkerListener(session, 'syncDone', callback, true),",
            "   },",
         ].join("\n"),
      );
   });

   it("writes send to a worker and broadcast to the workers of a session", async () => {
      const output = await render([
         { ...emitToWorker, params: ["key: string", "...rest: number[]"] },
      ]);

      expect(output).toContain(
         [
            "   configChanged: {",
            "      send: (worker: ServiceWorkerMain, key: string, ...rest: number[]): void =>",
            "         sendToWorker('configChanged', 'autoipc:configChanged', worker, [key, ...rest]),",
            "      broadcast: (session: Session, key: string, ...rest: number[]): void =>",
            "         broadcastToWorkers('autoipc:configChanged', session, [key, ...rest]),",
            "   },",
         ].join("\n"),
      );
   });

   it("writes invoke and invokeWith for a question to a worker, which return a promise", async () => {
      const output = await render([
         { ...askWorker, params: ["force: boolean"], returnType: "number" },
         { ...askWorker, name: "describe", returnType: "Promise<string>" },
      ]);

      expect(output).toContain(
         [
            "   flush: {",
            "      invoke: (worker: ServiceWorkerMain, force: boolean): Promise<Awaited<number>> =>",
            "         askServiceWorker('flush', 'autoipc:flush', worker, [force]) as Promise<Awaited<number>>,",
            "      invokeWith: (worker: ServiceWorkerMain, options: IpcAskOptions, force: boolean): Promise<Awaited<number>> =>",
            "         askServiceWorker('flush', 'autoipc:flush', worker, [force], options) as Promise<Awaited<number>>,",
            "   },",
         ].join("\n"),
      );
      expect(output).toContain(
         "invoke: (worker: ServiceWorkerMain): Promise<string> =>\n         askServiceWorker('describe', 'autoipc:describe', worker, []) as Promise<string>,",
      );
   });

   it("lists the channels by wire name, with the allowed origins", async () => {
      const output = await render([
         { ...invokeFromWorker, allowedOrigins: ["app://main", "http://localhost:5173"] },
         { ...invokeFromWorker, name: "open" },
         { ...sendFromWorker, allowedOrigins: ["app://main"] },
         askWorker,
      ]);

      expect(output).toContain(
         [
            "const workerCalls: WorkerChannelInfo[] = [",
            `   { channel: 'getToken', wire: 'autoipc:getToken', allowedOrigins: ["app://main", "http://localhost:5173"] },`,
            "   { channel: 'open', wire: 'autoipc:open' },",
            "];",
         ].join("\n"),
      );
      expect(output).toContain(
         `   { channel: 'syncDone', wire: 'autoipc:syncDone', allowedOrigins: ["app://main"] },`,
      );
      // A question is answered on the reply channel of the channel.
      expect(output).toContain("   { channel: 'flush', wire: 'autoipc:flush:reply' },");
   });

   describe("timeouts", () => {
      it("writes no timer without a timeout", async () => {
         const output = await render(all);
         for (const name of ["timeWorkerCall", "IPC_TIMEOUT", "info.timeoutMs"]) {
            expect(output).not.toContain(name);
         }
      });

      it("lists the timeout of each call that has one, the option first and else the default", async () => {
         const output = await render(
            [
               { ...invokeFromWorker, timeoutMs: 800 },
               { ...invokeFromWorker, name: "defaulted" },
               { ...invokeFromWorker, name: "patient", timeoutMs: 0 },
               sendFromWorker,
            ],
            { timeoutMs: 5000 },
         );

         expect(output).toContain(
            [
               "const workerCalls: WorkerChannelInfo[] = [",
               "   { channel: 'defaulted', wire: 'autoipc:defaulted', timeoutMs: 5000 },",
               "   { channel: 'getToken', wire: 'autoipc:getToken', timeoutMs: 800 },",
               "   { channel: 'patient', wire: 'autoipc:patient' },",
               "];",
            ].join("\n"),
         );
         expect(output).toContain("timeoutMs?: number;");
         expect(output).toContain(
            "function timeWorkerCall(info: WorkerChannelInfo, result: unknown): unknown {",
         );
         expect(output).toContain("'IpcTimeoutError'");
         expect(output).toContain("'IPC_TIMEOUT'");
         // The message has no timeout.
         expect(output).toContain("{ channel: 'syncDone', wire: 'autoipc:syncDone' },");
      });

      it("times the result of the handler inside the envelope", async () => {
         const output = await render([{ ...invokeFromWorker, timeoutMs: 800 }]);
         expect(output).toContain(
            "settleInvoke(() => timeWorkerCall(info, callWorkerHandler(hub, worker, event, info, args))),",
         );
      });

      it("times the result of the handler with rawErrors too", async () => {
         const output = await render([{ ...invokeFromWorker, timeoutMs: 800 }], {
            rawErrors: true,
         });
         expect(output).toContain(
            "timeWorkerCall(info, callWorkerHandler(hub, worker, event, info, args)),",
         );
         expect(output).not.toContain("settleInvoke(");
      });

      it("does not time a question to a worker, whatever the default is", async () => {
         const output = await render([askWorker, emitToWorker], { timeoutMs: 500 });
         expect(output).not.toContain("timeWorkerCall");
      });
   });

   describe("validation of the arguments", () => {
      const validate = { name: "idArgs", exported: "idArgs", fromPath: "./validators" };
      const validatedCall = { ...invokeFromWorker, params: ["id: number"], validate } as const;
      const validatedSend = {
         ...sendFromWorker,
         params: ["id: number"],
         validate: { ...validate, name: "lineArgs", exported: "lineArgs" },
      } as const;

      it("writes nothing for validation when no channel of a worker has a validator", async () => {
         const output = await render(all);
         for (const name of ["IpcValidationError", "validateArguments", "IpcArgumentsSchema"]) {
            expect(output).not.toContain(name);
         }
         expect(output).toContain(
            "onRejected?: (event: IpcMainServiceWorkerInvokeEvent | IpcMainServiceWorkerEvent, channel: string) => void;",
         );
         expect(output).toContain("workerConfig.onRejected(event, channel);");
         expect(output).toContain("const handler = hub.handlers[info.channel] as");
      });

      it("imports the validators and lists them in the tables of the channels", async () => {
         const output = await render([
            validatedCall,
            validatedSend,
            { ...invokeFromWorker, name: "plain" },
         ]);

         expect(output).toMatch(/^import \{ idArgs \} from "[^"]*validators";$/m);
         expect(output).toMatch(/^import \{ lineArgs \} from "[^"]*validators";$/m);
         expect(output).toContain(
            [
               "const workerCalls: WorkerChannelInfo[] = [",
               "   { channel: 'getToken', wire: 'autoipc:getToken', validator: idArgs },",
               "   { channel: 'plain', wire: 'autoipc:plain' },",
               "];",
            ].join("\n"),
         );
         expect(output).toContain(
            "   { channel: 'syncDone', wire: 'autoipc:syncDone', validator: lineArgs },",
         );
         expect(output).toContain("validator?: IpcArgumentsSchema;");
      });

      it("keeps the validator next to the allowed origins", async () => {
         const output = await render([{ ...validatedCall, allowedOrigins: ["app://main"] }]);
         expect(output).toContain(
            `   { channel: 'getToken', wire: 'autoipc:getToken', allowedOrigins: ["app://main"], validator: idArgs },`,
         );
      });

      it("declares the error, the schema types and a validation function for the worker events", async () => {
         const output = await render([validatedCall, validatedSend]);

         expect(output).toContain("export class IpcValidationError extends Error {");
         expect(output).toContain("function validateArguments<R>(");
         expect(output).toContain(
            "event: IpcMainServiceWorkerEvent | IpcMainServiceWorkerInvokeEvent,",
         );
         // A file without channels of pages has no hook of theirs, so the caller reports.
         expect(output).toContain(
            "report: (event: IpcMainServiceWorkerEvent | IpcMainServiceWorkerInvokeEvent, channel: string, error: IpcValidationError) => void,",
         );
         expect(output).toContain(
            "report(event as IpcMainServiceWorkerEvent | IpcMainServiceWorkerInvokeEvent, channel, error);",
         );
         expect(output).not.toContain("ipcConfig");
         expect(output).not.toContain("configureIpc");
      });

      it("types the events of the validated channels only", async () => {
         const output = await render([validatedCall]);
         expect(output).toContain("event: IpcMainServiceWorkerInvokeEvent,\n");
         expect(output).not.toContain("event: IpcMainServiceWorkerEvent,\n");
      });

      it("tells the hook why a call was rejected", async () => {
         const output = await render([validatedCall]);

         expect(output).toContain(
            "onRejected?: (event: IpcMainServiceWorkerInvokeEvent, channel: string, error: IpcWorkerError | IpcValidationError) => void;",
         );
         expect(output).toContain(
            "workerConfig.onRejected(event, channel, new IpcWorkerError(channel, `The service worker is not allowed to use the channel '${channel}'`, 'IPC_WORKER_FORBIDDEN'));",
         );
         expect(output).toContain(
            "(rejected, name, error) => workerConfig.onRejected?.(rejected, name, error)",
         );
      });

      it("rejects an invalid call after the sender check, and looks the handler up again", async () => {
         const output = await render([validatedCall]);

         expect(output).toMatch(
            /isWorkerAllowed\(worker, event, info\.channel, info\.allowedOrigins\)[\s\S]+?IPC_WORKER_FORBIDDEN[\s\S]+?const run = \(valid: unknown\[\]\): unknown => \{\n\s+const handler = hub\.handlers\[info\.channel\]/,
         );
         expect(output).toContain(
            "? validateArguments(event, info.channel, info.validator, args, false, run, ",
         );
         expect(output).toContain(": run(args);");
         expect(output).toContain("return handler(event, ...valid);");
      });

      it("drops an invalid message after the sender check, and looks the listeners up again", async () => {
         const output = await render([validatedSend]);

         expect(output).toContain("const run = (valid: unknown[]): void => {");
         expect(output).toContain(
            "void validateArguments(event, info.channel, info.validator, args, true, run, ",
         );
         expect(output).toContain(
            "(entry.callback as (...listenerArgs: unknown[]) => unknown)(event, ...valid);",
         );
      });

      it("validates in the handler call with rawErrors too, which leaves the rejection to Electron", async () => {
         const output = await render([validatedCall], { rawErrors: true });
         expect(output).toContain(
            "? validateArguments(event, info.channel, info.validator, args, false, run, ",
         );
         expect(output).toContain("callWorkerHandler(hub, worker, event, info, args),");
         expect(output).not.toContain("settleInvoke(");
      });

      it("serves a validated call and a plain message in one file", async () => {
         const output = await render([validatedCall, sendFromWorker]);
         // The messages are not validated, so their dispatcher has no run function.
         expect(output).toContain(
            "(entry.callback as (...listenerArgs: unknown[]) => unknown)(event, ...args);",
         );
         expect(output).not.toContain("void validateArguments(");
      });

      it("shares one validation function with the channels of the pages", async () => {
         const page = {
            ...renderer,
            params: ["id: number"],
            validate,
         } as const;
         const output = await render([page, validatedCall]);

         expect(output.match(/function validateArguments</g)).toHaveLength(1);
         expect(output).toContain("event: IpcMainInvokeEvent | IpcMainServiceWorkerInvokeEvent,");
         expect(output).toContain(
            "report?: (event: IpcMainServiceWorkerInvokeEvent, channel: string, error: IpcValidationError) => void,",
         );
         expect(output).toContain("if (report) {");
         expect(output).toContain(
            "ipcConfig.onRejected?.(event as IpcMainInvokeEvent, channel, error);",
         );
         // The hook of the pages does not see the events of the workers.
         expect(output).toContain(
            "onRejected?: (event: IpcMainInvokeEvent, channel: string, error: IpcForbiddenError | IpcValidationError) => void;",
         );
         // The page call is unchanged.
         expect(output).toContain("validateArguments(event, 'getUser', idArgs, received, false,");
      });
   });

   it("puts the channel prefix in front of every wire name", async () => {
      const output = await render(all, { channelPrefix: "app:" });

      expect(output).toContain("wire: 'app:getToken'");
      expect(output).toContain("wire: 'app:flush:reply'");
      expect(output).toContain("sendToWorker('configChanged', 'app:configChanged'");
      expect(output).toContain("askServiceWorker('flush', 'app:flush'");
   });

   it("routes the calls through settleInvoke, or leaves the errors to Electron with rawErrors", async () => {
      const enveloped = await render([invokeFromWorker]);
      expect(enveloped).toContain(
         "settleInvoke(() => callWorkerHandler(hub, worker, event, info, args)),",
      );
      expect(enveloped).toContain("async function settleInvoke(");
      const raw = await render([invokeFromWorker], { rawErrors: true });
      expect(raw).toContain("callWorkerHandler(hub, worker, event, info, args),");
      expect(raw).not.toContain("settleInvoke");
   });

   it("writes the hub only with the parts that the channels use", async () => {
      const output = await render([emitToWorker]);

      expect(output).toContain("interface WorkerHub {\n}");
      expect(output).not.toContain("workerCalls");
      expect(output).not.toContain("failWorkerAsks");
      expect(output).toContain("function routeWorker(");
      expect(output).toContain("export function attachServiceWorkers(session: Session): void {");
      const full = await render(all);
      expect(full).toContain("handlers: { [channel: string]: unknown };");
      expect(full).toContain("failWorkerAsks(hub, details.versionId);");
      expect(full).toContain("task = worker.startTask();");
   });

   it("shares the error class and reader of the questions with the asks of the renderers", async () => {
      const both = await render([
         askWorker,
         { name: "ask", kind: "Unicast", direction: "MainToRenderer" },
      ]);
      expect(both.match(/export class IpcAskError/g)).toHaveLength(1);
      expect(both.match(/function readAskReply/g)).toHaveLength(1);
      expect(both).toContain("readAskReply(channel, envelope, 'service worker')");
      expect(both).toContain(
         "function readAskReply(channel: string, envelope: unknown, who = 'renderer')",
      );
      const alone = await render([askWorker]);
      expect(alone.match(/export class IpcAskError/g)).toHaveLength(1);
      expect(alone).not.toContain("askRenderer");
   });

   it("declares nothing for the renderers when the schema has only worker channels", async () => {
      const output = await render(all);
      for (const name of ["IpcForbiddenError", "resolveIpcTarget", "listenForAskReplies"]) {
         expect(output).not.toContain(name);
      }
   });

   it("does not let a schema type take a name that the worker helpers declare", () => {
      const obj = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(invokeFromWorker));
      const reserved = (obj as unknown as { getReservedNames: () => string[] }).getReservedNames();
      for (const name of ["WorkerHub", "attachServiceWorkers", "Session", "IpcWorkerError"]) {
         expect(reserved).toContain(name);
      }
      const plain = new shared.VitestMainBindingsWriter(shared.buildFileSpecs(renderer));
      const plainReserved = (
         plain as unknown as { getReservedNames: () => string[] }
      ).getReservedNames();
      expect(plainReserved).not.toContain("WorkerHub");
   });

   it("keeps the generated parameter names clear of the names in the signature", async () => {
      const output = await render([
         { ...askWorker, params: ["worker: number", "options: string"] },
         { ...emitToWorker, params: ["session: string"] },
      ]);

      expect(output).toContain(
         "invoke: (_worker: ServiceWorkerMain, worker: number, options: string)",
      );
      expect(output).toContain("send: (worker: ServiceWorkerMain, session: string)");
      expect(output).toContain("broadcast: (_session: Session, session: string)");
   });
});

describe("ServiceWorkerPreloadWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestServiceWorkerPreloadWriter);

   const render = async (
      channels: shared.SimpleChannel[],
      config: Partial<t.IPCResolvedConfig> = {},
   ) => {
      const obj = new shared.VitestServiceWorkerPreloadWriter(shared.buildFileSpecs(...channels), {
         channelPrefix: "autoipc:",
         ...config,
      });
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };

   it("has channels only when the schema has a channel to or from a service worker", () => {
      const has = (...channels: shared.SimpleChannel[]) =>
         new shared.VitestServiceWorkerPreloadWriter(
            shared.buildFileSpecs(...channels),
         ).hasChannels();

      expect(has()).toBe(false);
      expect(has(renderer)).toBe(false);
      for (const channel of all) {
         expect(has(renderer, channel)).toBe(true);
      }
   });

   it("writes the API of a page for the channels of the worker, and leaves the others out", async () => {
      const output = await render([...all, renderer]);

      expect(output).toContain('import { contextBridge, ipcRenderer } from "electron";');
      expect(output).toContain("ipcRenderer.invoke('autoipc:getToken', ...args)");
      expect(output).toContain(
         "send: (...args: any[]) => ipcRenderer.send('autoipc:syncDone', ...args),",
      );
      expect(output).toContain(
         "on: (callback: Function) => {\n         return listenToChannel('autoipc:configChanged', callback, false);",
      );
      expect(output).toContain("handle: (callback: Function) => {");
      expect(output).toContain(
         "ipcRenderer.on('autoipc:flush', (_event: unknown, id: unknown, ...args: any[]) => {",
      );
      expect(output).toContain("void answerAsk('flush', 'autoipc:flush:reply', id, args);");
      const names = [...output.matchAll(/^ {3}(\w+): \{$/gm)].map((match) => match[1]);
      expect(names).toStrictEqual(["configChanged", "flush", "getToken", "syncDone"]);
      expect(output).not.toContain("getUser");
   });

   it("exposes the API under the exposeAs key, in the world of the worker", async () => {
      const output = await render([invokeFromWorker], {
         exposeAs: "workerIpc",
         isolatedWorldId: 1001,
      });

      expect(output).toContain("export function expose(key = 'workerIpc'): void {");
      expect(output).toContain("contextBridge.exposeInMainWorld(key, api);");
      expect(output).not.toContain("exposeInIsolatedWorld");
      expect(output).toMatch(/\nexpose\(\);\n$/);
   });

   it("leaves the exposing to the app with autoExpose off", async () => {
      const output = await render([invokeFromWorker], { autoExpose: false });
      expect(output).toContain("export function expose(");
      expect(output).not.toMatch(/\nexpose\(\);/);
   });

   it("has no helper for files, which belongs to pages", async () => {
      const output = await render([invokeFromWorker], { getPathForFile: true });
      expect(output).not.toContain("webUtils");
      expect(output).not.toContain("getPathForFile");
   });

   it("has no timer, which the preload script of a worker could not run", async () => {
      const output = await render(
         [
            { ...invokeFromWorker, timeoutMs: 800 },
            { ...invokeFromWorker, name: "defaulted" },
         ],
         { timeoutMs: 5000 },
      );
      expect(output).not.toContain("withTimeout");
      expect(output).not.toContain("setTimeout");
      expect(output).toContain("ipcRenderer.invoke('autoipc:getToken', ...args)");
   });

   it("does not unwrap the envelope with rawErrors", async () => {
      const output = await render([invokeFromWorker], { rawErrors: true });
      expect(output).toContain(
         "invoke: (...args: any[]) => ipcRenderer.invoke('autoipc:getToken', ...args),",
      );
   });
});

describe("ServiceWorkerTypesWriter", () => {
   mocks.mockGetTargetFilePath(shared.VitestServiceWorkerTypesWriter);

   const render = async (
      channels: shared.SimpleChannel[],
      config: Partial<t.IPCResolvedConfig> = {},
   ) => {
      const obj = new shared.VitestServiceWorkerTypesWriter(shared.buildFileSpecs(...channels), {
         channelPrefix: "autoipc:",
         ...config,
      });
      await obj.write(false);
      return (await fsp.readFile(obj.getTargetFilePath())).toString();
   };

   it("has channels only when the schema has a channel to or from a service worker", () => {
      const has = (...channels: shared.SimpleChannel[]) =>
         new shared.VitestServiceWorkerTypesWriter(
            shared.buildFileSpecs(...channels),
         ).hasChannels();

      expect(has(renderer)).toBe(false);
      expect(has(renderer, askWorker)).toBe(true);
   });

   it("declares the API of the worker for its own channels", async () => {
      const output = await render([
         {
            ...invokeFromWorker,
            params: ["scope: string"],
            returnType: "Promise<string>",
            errors: "AuthError",
         },
         { ...sendFromWorker, params: ["n: number"] },
         { ...askWorker, params: ["force: boolean"], returnType: "number" },
         { ...emitToWorker, params: ["key: string"] },
         renderer,
      ]);

      expect(output).toContain("interface IpcApi {");
      expect(output).toContain("/** @throws {IpcError<AuthError>} */");
      expect(output).toContain("invoke: (scope: string) => Promise<string>;");
      expect(output).toContain("send: (n: number) => void;");
      expect(output).toContain("handle: (callback: (force: boolean) => number) => () => void;");
      expect(output).toContain("on: (callback: (key: string) => void) => () => void;");
      expect(output).toContain("var ipc: IpcApi;");
      const names = [...output.matchAll(/^ {3}(\w+): \{$/gm)].map((match) => match[1]);
      expect(names).toStrictEqual(["configChanged", "flush", "getToken", "syncDone"]);
   });

   it("declares the global under the exposeAs name, without the helper for files", async () => {
      const output = await render([invokeFromWorker], {
         exposeAs: "workerIpc",
         getPathForFile: true,
         isolatedWorldId: 1001,
      });

      expect(output).toContain("var workerIpc: IpcApi;");
      expect(output).not.toContain("getPathForFile");
      expect(output).not.toContain("isolated world");
   });

   it("declares no timeout error without a timeout", async () => {
      const output = await render([invokeFromWorker]);
      expect(output).not.toContain("IpcTimeoutError");
   });

   it("declares the timeout error for a call that times out, by option or by the default", async () => {
      const byOption = await render([{ ...invokeFromWorker, timeoutMs: 500 }]);
      expect(byOption).toContain("type IpcTimeoutError =");
      expect(byOption).toContain("/** @throws {IpcError<IpcTimeoutError>} */");
      const byDefault = await render([invokeFromWorker], { timeoutMs: 500 });
      expect(byDefault).toContain("type IpcTimeoutError =");
      const off = await render([{ ...invokeFromWorker, timeoutMs: 0 }], { timeoutMs: 500 });
      expect(off).not.toContain("IpcTimeoutError");
   });

   it("leaves the timeout error out with rawErrors, which has no envelope for it", async () => {
      const output = await render([{ ...invokeFromWorker, timeoutMs: 500 }], { rawErrors: true });
      expect(output).not.toContain("IpcTimeoutError");
   });

   it("declares no timeout error for a message or a question", async () => {
      const output = await render([sendFromWorker, askWorker, emitToWorker], { timeoutMs: 500 });
      expect(output).not.toContain("IpcTimeoutError");
   });
});

describe("PreloadBindingsWriter, calls of a worker", () => {
   mocks.mockGetTargetFilePath(shared.VitestPreloadBindingsWriter);

   it("leaves the timeout of a worker call out of the preload script of the page", async () => {
      const obj = new shared.VitestPreloadBindingsWriter(
         shared.buildFileSpecs(renderer, { ...invokeFromWorker, timeoutMs: 800 }),
         { channelPrefix: "autoipc:" },
      );
      await obj.write(false);
      const output = (await fsp.readFile(obj.getTargetFilePath())).toString();
      expect(output).not.toContain("withTimeout");
      expect(output).not.toContain("getToken");
   });
});
