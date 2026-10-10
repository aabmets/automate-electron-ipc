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

import type * as t from "@types";
import { BaseWriter } from "../base-writer.js";
import { isBrokeredSpec, isUtilitySpec, isWorkerSpec } from "../channel-kinds.js";
import {
   APPLY_OVERRIDES,
   CALLBACK_TYPE,
   CREATE_LISTENERS,
   CREATE_RESPONDER,
   CREATE_STUB,
   DEEP_PARTIAL_TYPE,
   EMPTY_STREAM,
   reindent,
   STUB_TYPE,
   UNAVAILABLE,
} from "./mock-runtime.js";

/** How the page uses a channel, which decides what the mock of it is. */
type MockKind = "invoke" | "send" | "stream" | "ask" | "emit" | "port";

/** The methods of a port channel, none of which the mock can serve. */
const PORT_METHODS = ["send", "on", "onReady", "onClose", "onOverflow", "onConnection"];

/** The kind of a channel of the page, or `null` for the channels that the page has no part in. */
function mockKind(spec: t.ChannelSpec): MockKind | null {
   if (isUtilitySpec(spec) || isWorkerSpec(spec)) {
      return null;
   } else if (spec.kind === "Port") {
      return "port";
   } else if (isBrokeredSpec(spec)) {
      return spec.kind === "Stream" ? "stream" : "invoke";
   } else if (spec.kind === "Stream") {
      return "stream";
   } else if (spec.direction === "RendererToMain") {
      return spec.kind === "Broadcast" ? "send" : "invoke";
   } else if (spec.direction === "MainToRenderer") {
      return spec.kind === "Unicast" ? "ask" : "emit";
   }
   return null;
}

interface MockChannel {
   name: string;
   kind: MockKind;
}

/**
 * Writes `mock.ts`, a fake of the API of the page for unit tests of the renderer, Storybook and
 * a UI that runs in a plain browser. It takes the types from `types.ts`, has no dependency, and
 * covers the surface of no scope. The calls of `invoke`, `send` and `stream` are `Stub`s that
 * record their calls and take another implementation, `emit` and `ask` channels get the helpers
 * `mock.emit.<name>(...)` and `mock.ask.<name>(...)`, and the methods of a port channel throw.
 */
export class MockWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.config.mockFilePath;
   }
   /** The path of the types module that the mock takes `IpcApi` from. */
   protected getTypesFilePath(): string {
      return this.config.typesFilePath;
   }
   protected isEmpty(): boolean {
      return false;
   }
   protected renderEmptyFileContents(): string {
      return this.renderFileContents();
   }
   protected renderFileContents(): string {
      const channels = this.collectChannels();
      const kinds = new Set(channels.map((channel) => channel.kind));
      const pathForFile = this.getPathForFileEnabled();
      const listens = kinds.has("emit");
      const answers = kinds.has("ask");
      const stubs = kinds.has("invoke") || kinds.has("send") || kinds.has("stream") || pathForFile;
      const types = this.importsGenerator.getFileImportPath(this.getTypesFilePath());
      const indent = (snippet: string) => reindent(snippet, this.config.codeIndent);
      const parts = [
         `import type { IpcApi } from ${JSON.stringify(types)};`,
         indent(STUB_TYPE),
         indent(DEEP_PARTIAL_TYPE),
         ...(listens || answers ? [indent(CALLBACK_TYPE)] : []),
         this.renderMockType(channels, pathForFile),
         ...(stubs ? [indent(CREATE_STUB)] : []),
         ...(kinds.has("stream") ? [indent(EMPTY_STREAM)] : []),
         ...(listens ? [indent(CREATE_LISTENERS)] : []),
         ...(answers ? [indent(CREATE_RESPONDER)] : []),
         ...(kinds.has("port") ? [indent(UNAVAILABLE)] : []),
         indent(APPLY_OVERRIDES),
         this.renderCreate(channels, pathForFile),
         this.renderInstall(),
      ];
      return `${parts.join("\n\n")}\n`;
   }

   /** The channels of the page, sorted by name. */
   private collectChannels(): MockChannel[] {
      const channels = this.pfsArray.flatMap((pfs) =>
         pfs.specs.channelSpecArray.flatMap((spec) => {
            const kind = mockKind(spec);
            return kind === null ? [] : [{ name: spec.name, kind }];
         }),
      );
      return this.sortChannels(channels);
   }

   /** `IpcMock`: the API of the page, with `Stub`s for the calls, and the helpers `emit` and `ask`. */
   private renderMockType(channels: MockChannel[], pathForFile: boolean): string {
      const [i1, i2] = this.indents;
      const member = (name: string, type: string) => `${i1}${name}: ${type};`;
      const api = (name: string, method: string) => `IpcApi['${name}']['${method}']`;
      const block = (name: string, entries: string[]) =>
         entries.length === 0
            ? `${i1}${name}: {};`
            : [`${i1}${name}: {`, ...entries.map((entry) => `${i2}${entry}`), `${i1}};`].join("\n");
      const emits = channels.filter((channel) => channel.kind === "emit");
      const asks = channels.filter((channel) => channel.kind === "ask");
      return [
         "/**",
         " * The API of the page for a test. The calls are stubs, the other members are those of the API,",
         " * and `emit` and `ask` stand in for the main process: `emit.<name>(...)` calls the listeners of",
         " * a channel, and `ask.<name>(...)` asks the responder that the page registered.",
         " */",
         "export interface IpcMock {",
         ...channels.map(({ name, kind }) =>
            member(
               name,
               kind === "invoke" || kind === "send" || kind === "stream"
                  ? `{ ${kind}: Stub<${api(name, kind)}> }`
                  : `IpcApi['${name}']`,
            ),
         ),
         ...(pathForFile ? [member("getPathForFile", "Stub<IpcApi['getPathForFile']>")] : []),
         block(
            "emit",
            emits.map(
               ({ name }) =>
                  `${name}: (...args: Parameters<CallbackOf<${api(name, "on")}>>) => void;`,
            ),
         ),
         block(
            "ask",
            asks.map(({ name }) => {
               const callback = `CallbackOf<${api(name, "handle")}>`;
               return `${name}: (...args: Parameters<${callback}>) => Promise<Awaited<ReturnType<${callback}>>>;`;
            }),
         ),
         "}",
      ].join("\n");
   }

   /** `createIpcMock`, which makes the mock and applies the overrides to it. */
   private renderCreate(channels: MockChannel[], pathForFile: boolean): string {
      const [i1, i2, i3] = this.indents;
      const ofKind = (kind: MockKind) => channels.filter((channel) => channel.kind === kind);
      const emits = ofKind("emit");
      const asks = ofKind("ask");
      const entry = ({ name, kind }: MockChannel): string => {
         switch (kind) {
            case "invoke":
               return "{ invoke: createStub(() => Promise.resolve(undefined)) }";
            case "send":
               return "{ send: createStub(() => undefined) }";
            case "stream":
               return "{ stream: createStub(emptyStream) }";
            case "emit":
               return `{ on: listeners.${name}.on, once: listeners.${name}.once }`;
            case "ask":
               return `{ handle: responders.${name}.handle }`;
            default:
               return `{ ${PORT_METHODS.map((method) => `${method}: unavailable`).join(", ")} }`;
         }
      };
      const registry = (name: string, items: MockChannel[], make: (item: string) => string) =>
         items.length === 0
            ? []
            : [
                 `${i1}const ${name} = {`,
                 ...items.map((item) => `${i2}${item.name}: ${make(item.name)},`),
                 `${i1}};`,
              ];
      const helpers = (name: string, items: MockChannel[], member: string) =>
         items.length === 0
            ? `${i2}${name}: {},`
            : [
                 `${i2}${name}: {`,
                 ...items.map(
                    (item) =>
                       `${i3}${item.name}: ${member === "dispatch" ? "listeners" : "responders"}.${item.name}.${member},`,
                 ),
                 `${i2}},`,
              ].join("\n");
      return [
         "/**",
         " * Makes the mock of the API. `overrides` replace the implementation of a call, or the value of a",
         " * member, as the API has it.",
         " */",
         "export function createIpcMock(overrides: DeepPartial<IpcApi> = {}): IpcMock {",
         ...registry("listeners", emits, () => "createListeners()"),
         ...registry("responders", asks, (name) => `createResponder('${name}')`),
         `${i1}const mock: IpcMock = {`,
         ...channels.map((channel) => `${i2}${channel.name}: ${entry(channel)},`),
         ...(pathForFile ? [`${i2}getPathForFile: createStub(() => ''),`] : []),
         helpers("emit", emits, "dispatch"),
         helpers("ask", asks, "ask"),
         `${i1}};`,
         `${i1}applyOverrides(mock, overrides);`,
         `${i1}return mock;`,
         "}",
      ].join("\n");
   }

   /** `installIpcMock`, which sets the mock as the API of a target, and restores the target. */
   private renderInstall(): string {
      const [i1, i2, i3] = this.indents;
      const name = `'${this.getExposeAs()}'`;
      return [
         "/**",
         ` * Sets the mock as \`${this.getExposeAs()}\` of the target, which is \`globalThis\` unless given`,
         " * (pass `window` for a page of a test environment). Returns the function that puts back what the",
         " * target had before.",
         " */",
         "export function installIpcMock(",
         `${i1}mock: IpcMock = createIpcMock(),`,
         `${i1}target: object = globalThis,`,
         "): () => void {",
         `${i1}const previous = Object.getOwnPropertyDescriptor(target, ${name});`,
         `${i1}Object.defineProperty(target, ${name}, {`,
         `${i2}value: mock,`,
         `${i2}configurable: true,`,
         `${i2}enumerable: true,`,
         `${i2}writable: true,`,
         `${i1}});`,
         `${i1}let installed = true;`,
         `${i1}return () => {`,
         `${i2}if (!installed) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}installed = false;`,
         `${i2}if (previous) {`,
         `${i3}Object.defineProperty(target, ${name}, previous);`,
         `${i2}} else {`,
         `${i3}delete (target as any)[${name}];`,
         `${i2}}`,
         `${i1}};`,
         "}",
      ].join("\n");
   }
}
