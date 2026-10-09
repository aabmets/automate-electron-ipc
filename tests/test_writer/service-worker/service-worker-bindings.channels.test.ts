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
   all,
   askWorker,
   emitToWorker,
   invokeFromWorker,
   render,
   renderer,
   sendFromWorker,
} from "@testutils/writer/service-worker-writer-utils.js";
import mocks from "@testutils/writer/shared-mocks.js";
import shared from "@testutils/writer/writer-utils.js";
import { describe, expect, it } from "vitest";

describe("MainBindingsWriter, service worker channels", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);

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
