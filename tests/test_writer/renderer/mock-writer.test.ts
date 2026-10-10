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

import { renderWith } from "@testutils/writer/render-utils.js";
import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import { VitestMockWriter } from "@testutils/writer/test-writers.js";
import { getIt, type SimpleChannel, sendIt } from "@testutils/writer/writer-utils.js";
import type * as t from "@types";
import { describe, expect, it } from "vitest";

const askIt: SimpleChannel = { name: "askIt", kind: "Unicast", direction: "MainToRenderer" };
const emitIt: SimpleChannel = { name: "emitIt", kind: "Broadcast", direction: "MainToRenderer" };
const streamIt: SimpleChannel = { name: "streamIt", kind: "Stream", direction: "RendererToMain" };
const portIt: SimpleChannel = { name: "portIt", kind: "Port", direction: "RendererToRenderer" };

describe("MockWriter", () => {
   mockGetTargetFilePath(VitestMockWriter);

   const render = (channels: SimpleChannel[], config: Partial<t.IPCResolvedConfig> = {}) =>
      renderWith(VitestMockWriter, channels, config);

   describe("the mock of each kind of channel", () => {
      it("imports IpcApi from the types module next to the file", () => {
         expect(render([getIt])).toMatch(/^import type \{ IpcApi \} from "\.\/types";$/m);
      });

      it("imports it with the extension that a NodeNext project needs", () => {
         expect(render([getIt], { projectUsesNodeNext: true })).toContain(
            'import type { IpcApi } from "./types.js";',
         );
      });

      it("makes a stub of the invoke of a channel, which resolves undefined", () => {
         const output = render([getIt]);

         expect(output).toContain("getIt: { invoke: Stub<IpcApi['getIt']['invoke']> };");
         expect(output).toContain(
            "getIt: { invoke: createStub(() => Promise.resolve(undefined)) },",
         );
      });

      it("makes a stub of the send of a broadcast, which returns undefined", () => {
         const output = render([sendIt]);

         expect(output).toContain("sendIt: { send: Stub<IpcApi['sendIt']['send']> };");
         expect(output).toContain("sendIt: { send: createStub(() => undefined) },");
      });

      it("makes a stub of a stream, which returns an empty stream", () => {
         const output = render([streamIt]);

         expect(output).toContain("streamIt: { stream: Stub<IpcApi['streamIt']['stream']> };");
         expect(output).toContain("streamIt: { stream: createStub(emptyStream) },");
         expect(output).toContain("function emptyStream(): any {");
      });

      it("treats a call to a utility process by a page like the other calls", () => {
         const output = render([
            { name: "indexIt", kind: "Unicast", direction: "RendererToUtility" },
            { name: "linesOf", kind: "Stream", direction: "RendererToUtility" },
         ]);

         expect(output).toContain("indexIt: { invoke: Stub<IpcApi['indexIt']['invoke']> };");
         expect(output).toContain("linesOf: { stream: Stub<IpcApi['linesOf']['stream']> };");
      });

      it("keeps the listeners of an emit channel, and types the helper by its on method", () => {
         const output = render([emitIt]);

         expect(output).toContain("emitIt: IpcApi['emitIt'];");
         expect(output).toContain("emitIt: createListeners(),");
         expect(output).toContain(
            "emitIt: { on: listeners.emitIt.on, once: listeners.emitIt.once },",
         );
         expect(output).toContain("emitIt: listeners.emitIt.dispatch,");
         expect(output).toContain(
            "emitIt: (...args: Parameters<CallbackOf<IpcApi['emitIt']['on']>>) => void;",
         );
      });

      it("keeps the responder of an ask channel, and types the helper by its handle method", () => {
         const output = render([askIt]);

         expect(output).toContain("askIt: IpcApi['askIt'];");
         expect(output).toContain("askIt: createResponder('askIt'),");
         expect(output).toContain("askIt: { handle: responders.askIt.handle },");
         expect(output).toContain("askIt: responders.askIt.ask,");
         expect(output).toContain(
            "askIt: (...args: Parameters<CallbackOf<IpcApi['askIt']['handle']>>) => Promise<Awaited<ReturnType<CallbackOf<IpcApi['askIt']['handle']>>>>;",
         );
      });

      it("makes every method of a port channel throw", () => {
         const output = render([portIt]);

         expect(output).toContain(
            "portIt: { send: unavailable, on: unavailable, onReady: unavailable, onClose: unavailable, onOverflow: unavailable, onConnection: unavailable },",
         );
         expect(output).toContain("throw new Error('ports are not mocked');");
      });

      it("leaves out the channels between the main process and a utility process or a worker", () => {
         const output = render([
            getIt,
            { name: "toChild", kind: "Unicast", direction: "MainToUtility" },
            { name: "fromChild", kind: "Unicast", direction: "UtilityToMain" },
            { name: "toWorker", kind: "Unicast", direction: "MainToServiceWorker" },
            { name: "fromWorker", kind: "Unicast", direction: "ServiceWorkerToMain" },
         ]);

         expect(output).toContain("getIt: { invoke");
         for (const name of ["toChild", "fromChild", "toWorker", "fromWorker"]) {
            expect(output).not.toContain(name);
         }
      });

      it("lists the channels by name, whatever their kind", () => {
         const output = render([sendIt, emitIt, getIt, askIt]);
         const members = output.slice(output.indexOf("export function createIpcMock"));

         const order = ["askIt:", "emitIt:", "getIt:", "sendIt:"].map((name) =>
            members.indexOf(`      ${name} {`),
         );
         expect(order.every((at) => at > 0)).toBe(true);
         expect(order).toStrictEqual([...order].sort((a, b) => a - b));
      });
   });

   describe("the runtime helpers", () => {
      it("writes only the helpers that the channels need", () => {
         const output = render([getIt]);

         expect(output).toContain("function createStub<");
         expect(output).toContain("function applyOverrides(");
         for (const unused of [
            "function emptyStream",
            "function createListeners",
            "function createResponder",
            "function unavailable",
            "type CallbackOf",
         ]) {
            expect(output).not.toContain(unused);
         }
      });

      it("writes the helpers of every kind of channel that the page has", () => {
         const output = render([getIt, streamIt, emitIt, askIt, portIt]);

         for (const helper of [
            "function createStub<",
            "function emptyStream",
            "function createListeners",
            "function createResponder",
            "function unavailable",
            "type CallbackOf",
         ]) {
            expect(output).toContain(helper);
         }
      });

      it("keeps the semantics of the subscriptions of the preload script", () => {
         const output = render([emitIt]);

         expect(output).toContain("for (const subscriber of subscribers.slice()) {");
         expect(output).toContain("if (subscriber.once) {");
         expect(output).toContain("console.error(error);");
      });

      it("rejects a question without a responder with the code of the preload script", () => {
         const output = render([askIt]);

         expect(output).toContain("name: 'IpcAskError',");
         expect(output).toContain("code: 'IPC_ASK_NO_HANDLER',");
      });

      it("exports the stub, the overrides type, the mock and the two functions", () => {
         const output = render([getIt]);

         expect(output).toContain("export interface Stub<F extends (...args: any[]) => any> {");
         expect(output).toContain("export type DeepPartial<T> = {");
         expect(output).toContain("export interface IpcMock {");
         expect(output).toContain(
            "export function createIpcMock(overrides: DeepPartial<IpcApi> = {}): IpcMock {",
         );
         expect(output).toContain("export function installIpcMock(");
      });
   });

   describe("a page without channels", () => {
      it("is a mock without members, with no helper that nothing uses", () => {
         const output = render([]);

         expect(output).toContain("export interface IpcMock {\n   emit: {};\n   ask: {};\n}");
         expect(output).toContain(
            "const mock: IpcMock = {\n      emit: {},\n      ask: {},\n   };",
         );
         expect(output).not.toContain("function createStub");
      });
   });

   describe("the config", () => {
      it("adds getPathForFile as a stub that returns an empty path", () => {
         const output = render([getIt], { getPathForFile: true });

         expect(output).toContain("getPathForFile: Stub<IpcApi['getPathForFile']>;");
         expect(output).toContain("getPathForFile: createStub(() => ''),");
      });

      it("has no getPathForFile without the config", () => {
         expect(render([getIt])).not.toContain("getPathForFile");
      });

      it("installs the mock as ipc, or else under the exposeAs name", () => {
         expect(render([getIt])).toContain("Object.getOwnPropertyDescriptor(target, 'ipc')");
         expect(render([getIt], { exposeAs: "bridge" })).toContain(
            "Object.getOwnPropertyDescriptor(target, 'bridge')",
         );
      });

      it("indents with the codeIndent of the config, also in the helpers", () => {
         const output = render([getIt, emitIt], { codeIndent: 2 });

         expect(output).toContain("\n  getIt: { invoke: Stub<IpcApi['getIt']['invoke']> };");
         expect(output).toContain("\n  let replacement: ");
         expect(output).toContain("\n    subscribers.push(subscriber);");
         expect(output).not.toMatch(/^ {3}\S/m);
      });
   });
});
