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
import { collectScopes } from "../scopes.js";
import utils from "../utils.js";
import { BaseWriter } from "./base-writer.js";
import { askErrorLines, readAskReplyLines } from "./main-asks.js";
import {
   addScopeImports,
   addStreamImports,
   addTargetImports,
   buildImports,
   getImportedTypes,
   getIpcMainImport,
   importCustomTypes,
} from "./main-imports.js";
import { buildPort } from "./main-ports.js";
import { hasScopedGuards } from "./main-registries.js";
import { buildRendererToMainChannel, getEventType, hasEnvelope } from "./main-renderer-channels.js";
import { buildMainToRendererChannel, getSenderTypes } from "./main-senders.js";
import { buildSupport } from "./main-support.js";
import { buildBrokeredChannel, buildUtilityChannel } from "./main-utility.js";
import { importValidator } from "./main-validation.js";
import { UTILITY_RUNTIME_NAMES } from "./utility-runtime.js";

export interface ChannelEntry {
   name: string;
   /** The members of the channel object, one per line, indented for the object body. */
   members: string[];
}

/**
 * What the modules of the generated `main.ts` read from the writer: the indents, the config, and
 * the helpers of `BaseWriter` that they call, bound to the writer. A function which reads only the
 * indents takes `indents` instead.
 */
export interface MainContext {
   indents: string[];
   config: t.IPCResolvedConfig;
   /** Whether the config names a serializer. */
   usesSerializer: boolean;
   wireName: (name: string, suffix?: string) => string;
   isSerializedSpec: (spec: t.ChannelSpec) => boolean;
   collectIdentifiers: (snippets: string[]) => Set<string>;
   uniqueName: (base: string, taken: Set<string>) => string;
   getOriginalParams: (spec: t.ChannelSpec, onlyNames: boolean) => string;
   getTypeParams: (signature: t.CallableSignature) => string;
   injectEventTypehint: (
      signature: t.CallableSignature,
      eventType: string,
      eventName?: string,
   ) => string;
   getHighWaterMark: (spec: t.ChannelSpec) => string;
   getMaxQueue: (spec: t.ChannelSpec) => string;
   getTimeoutMs: (spec: t.ChannelSpec) => number;
   getTimeoutArgument: (spec: t.ChannelSpec) => string;
}

/**
 * The names that the helpers of the channels to a service worker declare, import or use, which a
 * schema type of the same name must not shadow.
 */
const WORKER_RESERVED_NAMES = [
   "IpcWorkerError",
   "IpcWorkerConfig",
   "workerConfig",
   "configureServiceWorkerIpc",
   "WorkerChannelInfo",
   "WorkerListener",
   "PendingWorkerAsk",
   "WorkerHub",
   "sessionHubs",
   "workerHubs",
   "workerCalls",
   "workerSends",
   "workerAsks",
   "lastWorkerAskId",
   "attachServiceWorkers",
   "getWorkerHub",
   "routeWorker",
   "getWorkerOrigin",
   "isWorkerAllowed",
   "callWorkerHandler",
   "timeWorkerCall",
   "dispatchWorkerSend",
   "answerWorkerAsk",
   "failWorkerAsks",
   "registerWorkerHandler",
   "addWorkerListener",
   "sendToWorker",
   "broadcastToWorkers",
   "askServiceWorker",
   "Session",
   "ServiceWorkerMain",
   "IpcMainServiceWorkerEvent",
   "IpcMainServiceWorkerInvokeEvent",
   "WeakMap",
   "URL",
   "Object",
   "Number",
   "console",
];

/** What the channels that are not between the main process and a renderer need. */
interface OffPageUse {
   utility: boolean;
   brokers: boolean;
   envelope: boolean;
   workers: t.ChannelSpec[];
   /** The local names of the validators of the channels that a service worker calls. */
   validators: Map<t.ChannelSpec, string>;
}

export class MainBindingsWriter extends BaseWriter {
   private readonly ctx: MainContext = {
      indents: this.indents,
      config: this.config,
      usesSerializer: this.usesSerializer(),
      wireName: this.wireName.bind(this),
      isSerializedSpec: this.isSerializedSpec.bind(this),
      collectIdentifiers: this.collectIdentifiers.bind(this),
      uniqueName: this.uniqueName.bind(this),
      getOriginalParams: this.getOriginalParams.bind(this),
      getTypeParams: this.getTypeParams.bind(this),
      injectEventTypehint: this.injectEventTypehint.bind(this),
      getHighWaterMark: this.getHighWaterMark.bind(this),
      getMaxQueue: this.getMaxQueue.bind(this),
      getTimeoutMs: this.getTimeoutMs.bind(this),
      getTimeoutArgument: this.getTimeoutArgument.bind(this),
   };
   protected getTargetFilePath(): string {
      return this.config.mainBindingsFilePath;
   }
   protected getReservedNames(): string[] {
      // The globals that only the helpers of port channels use.
      const portGlobals = this.hasPorts("RendererToRenderer") || this.hasPorts("MainToRenderer");
      return [
         ...(portGlobals ? ["Map", "Set"] : this.hasBrokeredChannels() ? ["Map"] : []),
         ...(this.hasPorts("MainToRenderer") ? ["Function"] : []),
         "ipc",
         "electronIpcMain",
         "MessageChannelMain",
         "BrowserWindow",
         "IpcMainEvent",
         "IpcMainInvokeEvent",
         // Declared by the generated code.
         "registeredHandlers",
         "IpcMain",
         "IpcListenOptions",
         "IpcTarget",
         "IpcContentsRecord",
         "contentsIpcRegistry",
         "resolveIpcTarget",
         "IpcForbiddenError",
         "IpcConfig",
         "ipcConfig",
         "configureIpc",
         "isSenderAllowed",
         "IpcScope",
         "ScopeEntry",
         "ipcScopeNames",
         "scopeRegistry",
         "registerScope",
         "IpcValidationError",
         "IpcValidationIssue",
         "IpcArgumentsSchema",
         "IpcSchemaResult",
         "validateArguments",
         "WebContents",
         "WebContentsView",
         "WebFrameMain",
         "electronWebContents",
         "resolveSendTarget",
         "broadcastMessage",
         "sendToSenderFrame",
         "IpcErrorInfo",
         "IpcEnvelope",
         "toIpcError",
         "settleInvoke",
         "IpcAskError",
         "IpcAskOptions",
         "PendingAsk",
         "pendingAsks",
         "askReplyListeners",
         "lastAskId",
         "isSameFrame",
         "listenForAskReplies",
         "readAskReply",
         "askRenderer",
         "connectPorts",
         "lastPortConnectionId",
         "portEnds",
         "portDisconnectChannels",
         "listenForPortDisconnects",
         "PageLoadWatch",
         "watchPageLoad",
         "WatchableEmitter",
         "EventWatch",
         "eventWatches",
         "watchEvent",
         "MessagePortMain",
         "MainPortConnection",
         "MainPortListener",
         "notifyMainPortListeners",
         "addMainPortListener",
         "connectMainPort",
         "PortOverflowInfo",
         "PortsConfig",
         "portsConfig",
         "configurePorts",
         "MainPortQueue",
         "enqueueMainPort",
         "startStream",
         "stopIterator",
         "lastUtilityLinkId",
         "utilityLinks",
         "connectUtilityPort",
         // The serializer of the config.
         ...(this.usesSerializer()
            ? [
                 "ipcSerialize",
                 "ipcDeserialize",
                 "IpcSerializationError",
                 "encodeValue",
                 "decodeValue",
                 "readArguments",
                 "readSentArguments",
                 "console",
              ]
            : []),
         // Globals that the generated code uses.
         "Promise",
         "Error",
         "TypeError",
         "Array",
         "Awaited",
         "Symbol",
         "AsyncIterable",
         "AsyncIterator",
         "IteratorResult",
         "structuredClone",
         "Math",
         "Infinity",
         "Parameters",
         "setTimeout",
         "clearTimeout",
         ...(this.usesEventWatch() ? ["WeakMap"] : []),
         // The channels to a utility process.
         ...(this.hasUtilityChannels()
            ? [
                 ...UTILITY_RUNTIME_NAMES,
                 "UtilityProcess",
                 "WeakMap",
                 "utilityPeers",
                 "getUtilityPeer",
                 "callUtilityChild",
                 "attachUtility",
                 "forkUtility",
                 "utilityProcess",
              ]
            : []),
         // The channels to a service worker.
         ...(this.hasWorkerChannels() ? WORKER_RESERVED_NAMES : []),
      ];
   }
   /**
    * The main process only pairs the pages of a `port` channel, and brokers the port between a page and
    * a utility process, and sees none of their messages.
    */
   protected isSerializedSpec(spec: t.ChannelSpec): boolean {
      return (
         spec.direction !== "RendererToRenderer" &&
         spec.direction !== "RendererToUtility" &&
         super.isSerializedSpec(spec)
      );
   }
   protected renderEmptyFileContents(): string {
      return "export const ipc = {};";
   }
   protected renderFileContents(): string {
      // Only the imports that the generated code uses.
      let usesIpcMain = false;
      const electronImportsSet = new Set<string>();
      const electronTypeImportsSet = new Set<string>();
      const importDeclarationsArray: string[] = [];
      const channels: ChannelEntry[] = [];
      let usesValidation = false;
      let usesEnvelope = false;
      let usesSenders = false;
      let usesStreams = false;
      const offPage: OffPageUse = {
         utility: false,
         brokers: false,
         envelope: false,
         workers: [],
         validators: new Map(),
      };
      const eventTypes = new Set<string>();

      for (const parsedFileSpecs of this.pfsArray) {
         let customTypes: Set<string> = new Set();

         for (const spec of this.getChannelSpecs(parsedFileSpecs)) {
            if (spec.kind === "Port") {
               channels.push(buildPort(this.ctx, spec, electronImportsSet, electronTypeImportsSet));
            } else if (spec.direction === "RendererToMain") {
               usesIpcMain = true;
               electronTypeImportsSet.add(getEventType(spec));
               eventTypes.add(getEventType(spec));
               usesEnvelope ||= hasEnvelope(this.ctx, spec);
               usesStreams ||= spec.kind === "Stream";
               const validator = importValidator(
                  this.importsGenerator,
                  parsedFileSpecs,
                  spec,
                  importDeclarationsArray,
               );
               usesValidation ||= validator !== null;
               channels.push(buildRendererToMainChannel(this.ctx, spec, validator));
            } else if (spec.direction === "MainToRenderer") {
               usesSenders = true;
               electronImportsSet.add("webContents as electronWebContents");
               for (const type of getSenderTypes(spec)) {
                  electronTypeImportsSet.add(type);
               }
               channels.push(buildMainToRendererChannel(this.ctx, spec));
            } else {
               const validator = importValidator(
                  this.importsGenerator,
                  parsedFileSpecs,
                  spec,
                  importDeclarationsArray,
               );
               if (validator !== null) {
                  offPage.validators.set(spec, validator);
               }
               channels.push(
                  ...this.buildOffPageChannels(
                     spec,
                     electronImportsSet,
                     electronTypeImportsSet,
                     offPage,
                  ),
               );
            }
            const specCustomTypes = new Set(getImportedTypes(spec, this.isBrokeredSpec(spec)));
            customTypes = customTypes.union(specCustomTypes);
         }
         importCustomTypes(
            this.importsGenerator,
            parsedFileSpecs,
            customTypes,
            importDeclarationsArray,
         );
      }
      usesEnvelope ||= offPage.envelope;
      if (this.hasSerializedChannels()) {
         importDeclarationsArray.push(this.buildSerializerImport());
      }
      this.addWorkerImports(offPage.workers, electronTypeImportsSet);
      addStreamImports(usesStreams, electronImportsSet, electronTypeImportsSet);
      addTargetImports(usesIpcMain, electronTypeImportsSet);
      const scopes = collectScopes(this.pfsArray);
      addScopeImports(scopes.length > 0, electronTypeImportsSet);
      const usesAsks = this.hasChannels("Unicast");
      const usesEmits = this.hasChannels("Broadcast");
      const usesRendererPorts = this.hasPorts("RendererToRenderer");
      const usesMainPorts = this.hasPorts("MainToRenderer");
      const usesPorts = usesRendererPorts || usesMainPorts;
      const out = buildImports(
         [...getIpcMainImport(usesIpcMain || usesAsks || usesPorts), ...electronImportsSet],
         [...electronTypeImportsSet],
         importDeclarationsArray,
      );
      const [i0] = this.indents;
      const bindingsExpression = buildSupport(
         this.ctx,
         {
            usesIpcMain,
            usesValidation,
            usesEnvelope,
            usesSenders,
            usesEmits,
            usesAsks,
            usesPorts,
            usesRendererPorts,
            usesMainPorts,
            usesStreams,
            usesSerializer: this.hasSerializedChannels(),
            usesUtility: offPage.utility,
            usesBrokers: offPage.brokers,
            workerSpecs: offPage.workers,
            workerValidators: offPage.validators,
            scopes,
            usesScopedGuards: hasScopedGuards(this.pfsArray),
            usesEventWatch: this.usesEventWatch(),
         },
         [...eventTypes].sort(utils.compareStrings),
         {
            workerHelpers: (specs, usesAsks, validators) =>
               this.buildWorkerHelpers(specs, usesAsks, validators),
            workerEventType: (spec) => this.getWorkerEventType(spec),
         },
      );
      bindingsExpression.push("\nexport const ipc = {");
      for (const channel of this.sortChannels(channels)) {
         bindingsExpression.push(`\n${i0}${channel.name}: {`, ...channel.members, `\n${i0}},`);
      }
      bindingsExpression.push("\n}\n");

      out.push(bindingsExpression.join(""));
      return this.joinComponents(out);
   }
   /**
    * Builds the channel of a spec between the main process and a utility process, between a page
    * and a utility process or between the main process and a service worker, and notes what it
    * needs. The specs of the pages are built by the caller.
    */
   private buildOffPageChannels(
      spec: t.ChannelSpec,
      values: Set<string>,
      types: Set<string>,
      uses: OffPageUse,
   ): ChannelEntry[] {
      if (this.isUtilitySpec(spec)) {
         uses.utility = true;
         uses.envelope = true;
         values.add("utilityProcess");
         types.add("UtilityProcess");
         return [buildUtilityChannel(this.ctx, spec)];
      } else if (this.isBrokeredSpec(spec)) {
         // The page is connected to a child which the peers know, so that its exit is seen (T86).
         uses.utility = true;
         uses.envelope = true;
         uses.brokers = true;
         values.add("utilityProcess");
         types.add("UtilityProcess");
         return [buildBrokeredChannel(this.ctx, spec, values, types)];
      }
      // The specs left are the ones between the main process and a service worker.
      uses.workers.push(spec);
      uses.envelope ||= this.usesWorkerEnvelope(spec);
      return [this.buildWorkerChannel(spec)];
   }
   /** Whether any schema file declares a channel of the kind from the main process to a renderer. */
   private hasChannels(kind: t.ChannelKind): boolean {
      return this.pfsArray.some((pfs) =>
         pfs.specs.channelSpecArray.some(
            (spec) => spec.direction === "MainToRenderer" && spec.kind === kind,
         ),
      );
   }
   /**
    * Whether the generated code watches events of contents, windows or children for the calls or
    * connections it holds open: `ask`, `stream`, `port` and `mainPort` channels, and the brokered
    * channels of a utility process.
    */
   private usesEventWatch(): boolean {
      return this.pfsArray.some((pfs) =>
         pfs.specs.channelSpecArray.some(
            (spec) =>
               spec.kind === "Port" ||
               (spec.kind === "Stream" && spec.direction === "RendererToMain") ||
               (spec.kind === "Unicast" && spec.direction === "MainToRenderer") ||
               this.isBrokeredSpec(spec),
         ),
      );
   }
   /** Whether any schema file declares a channel between a renderer and a utility process. */
   private hasBrokeredChannels(): boolean {
      return this.pfsArray.some((pfs) =>
         pfs.specs.channelSpecArray.some((spec) => this.isBrokeredSpec(spec)),
      );
   }
   /** Whether any schema file declares a port channel with the direction. */
   private hasPorts(direction: t.ChannelDirection): boolean {
      return this.pfsArray.some((pfs) =>
         pfs.specs.channelSpecArray.some(
            (spec) => spec.kind === "Port" && spec.direction === direction,
         ),
      );
   }

   /** Whether the results and errors of the handler of a channel that a worker calls are an envelope. */
   private usesWorkerEnvelope(spec: t.ChannelSpec): boolean {
      return (
         spec.direction === "ServiceWorkerToMain" &&
         spec.kind === "Unicast" &&
         !this.config.rawErrors
      );
   }
   /** Adds the electron types that the helpers of the channels to a service worker use. */
   private addWorkerImports(specs: t.ChannelSpec[], types: Set<string>): void {
      if (specs.length === 0) {
         return;
      }
      types.add("Session");
      types.add("ServiceWorkerMain");
      for (const spec of specs) {
         if (spec.direction === "ServiceWorkerToMain") {
            types.add(this.getWorkerEventType(spec));
         }
      }
   }
   /**
    * Electron passes an `IpcMainServiceWorkerInvokeEvent` to `handle` listeners and an
    * `IpcMainServiceWorkerEvent` to `on` listeners. Neither has a `senderFrame`.
    */
   private getWorkerEventType(spec: t.ChannelSpec): string {
      return spec.kind === "Broadcast"
         ? "IpcMainServiceWorkerEvent"
         : "IpcMainServiceWorkerInvokeEvent";
   }
   /**
    * The helpers of the channels between the main process and service workers.
    *
    * The messages of a service worker do not reach `ipcMain`: they go to the `ipc` of its
    * `ServiceWorkerMain`, and a worker can send from its preload script, before the app could
    * register anything on the object. So the main process keeps one hub per `Session`. It watches the
    * `running-status-changed` event of `session.serviceWorkers`, and routes every channel that a
    * worker calls on the `ipc` of each worker as it starts, to the callbacks that the hub holds. A
    * callback is registered per session, so it is there for every worker, also for one that starts
    * later. `attachServiceWorkers(session)` makes the hub, and `handle` and `on` do so as well.
    *
    * What a worker sends is untrusted. The event has no `senderFrame`, so a channel with
    * `allowedOrigins` compares them with the origin of the scope of the worker, and the
    * `validateSender` hook of `configureServiceWorkerIpc` sees the event, with `versionId` and
    * `serviceWorker.scope`. A call from a worker that is rejected throws an `IpcWorkerError`, and a
    * message is dropped. A reply to a question counts only when it comes from the worker that was
    * asked, on the reply channel of the channel, with an ID that is pending.
    *
    * A question keeps its worker alive with `startTask` until it is settled, and is rejected with the
    * code `IPC_ASK_DESTROYED` when the worker stops, or `IPC_ASK_NOT_ATTACHED` when no hub knows it.
    * `IpcMainServiceWorker` has no `off`, so a worker is only ever given routes, which look their
    * callbacks up when a message arrives.
    */
   private buildWorkerHelpers(
      specs: t.ChannelSpec[],
      hasRendererAsks: boolean,
      validators: Map<t.ChannelSpec, string>,
   ): string {
      const [i1, i2, i3, i4] = this.indents;
      const validates = validators.size > 0;
      // An invalid call is reported to the hook, with the error, like a call that is forbidden.
      const reportInvalid =
         "(rejected, name, error) => workerConfig.onRejected?.(rejected, name, error)";
      const pick = (direction: t.ChannelDirection, kind: t.ChannelKind) =>
         specs
            .filter((spec) => spec.direction === direction && spec.kind === kind)
            .sort((a, b) => utils.compareStrings(a.name, b.name));
      const calls = pick("ServiceWorkerToMain", "Unicast");
      const sends = pick("ServiceWorkerToMain", "Broadcast");
      const asks = pick("MainToServiceWorker", "Unicast");
      const times = calls.some((spec) => this.getTimeoutMs(spec) > 0);
      const validatesCalls = calls.some((spec) => validators.has(spec));
      const validatesSends = sends.some((spec) => validators.has(spec));
      const inbound = calls.length > 0 || sends.length > 0;
      const events = [
         ...(calls.length > 0 ? ["IpcMainServiceWorkerInvokeEvent"] : []),
         ...(sends.length > 0 ? ["IpcMainServiceWorkerEvent"] : []),
      ].join(" | ");
      const out: string[] = [""];
      if (asks.length > 0 && !hasRendererAsks) {
         out.push(...askErrorLines(this.indents), ...readAskReplyLines(this.indents));
      }
      out.push(
         "export class IpcWorkerError extends Error {",
         `${i1}readonly code: string;`,
         `${i1}readonly channel: string;`,
         `${i1}constructor(channel: string, message: string, code: string) {`,
         `${i2}super(message);`,
         `${i2}this.name = 'IpcWorkerError';`,
         `${i2}this.channel = channel;`,
         `${i2}this.code = code;`,
         `${i1}}`,
         "}",
         "",
      );
      out.push(
         ...this.buildWorkerConfigLines({
            inbound,
            events,
            hasAsks: asks.length > 0,
            validates,
            times,
         }),
      );
      const table = (
         name: string,
         list: t.ChannelSpec[],
         wire: (spec: t.ChannelSpec) => string,
      ) => [
         `const ${name}: WorkerChannelInfo[] = [`,
         ...list.map((spec) => this.describeWorkerChannel(spec, wire(spec), validators.get(spec))),
         "];",
         "",
      ];
      if (calls.length > 0) {
         out.push(...table("workerCalls", calls, (spec) => this.wireName(spec.name)));
      }
      if (sends.length > 0) {
         out.push(...table("workerSends", sends, (spec) => this.wireName(spec.name)));
      }
      if (asks.length > 0) {
         out.push(...table("workerAsks", asks, (spec) => this.wireName(spec.name, ":reply")));
      }
      out.push(
         ...(sends.length > 0
            ? [
                 "interface WorkerListener {",
                 `${i1}callback: unknown;`,
                 `${i1}once: boolean;`,
                 "}",
                 "",
              ]
            : []),
         ...(asks.length > 0
            ? [
                 "interface PendingWorkerAsk {",
                 `${i1}channel: string;`,
                 `${i1}versionId: number;`,
                 `${i1}answer: (envelope: unknown) => void;`,
                 `${i1}fail: (error: IpcAskError) => void;`,
                 "}",
                 "",
              ]
            : []),
         "interface WorkerHub {",
         ...(calls.length > 0 ? [`${i1}handlers: { [channel: string]: unknown };`] : []),
         ...(sends.length > 0
            ? [`${i1}listeners: { [channel: string]: WorkerListener[] | undefined };`]
            : []),
         ...(asks.length > 0 ? [`${i1}asks: { [id: string]: PendingWorkerAsk | undefined };`] : []),
         "}",
         "",
         "const sessionHubs = new WeakMap<Session, WorkerHub>();",
         "const workerHubs = new WeakMap<ServiceWorkerMain, WorkerHub>();",
         ...(asks.length > 0 ? ["let lastWorkerAskId = 0;"] : []),
         "",
      );
      if (inbound) {
         out.push(...this.buildWorkerSenderCheck(events, validates));
      }
      if (calls.length > 0) {
         out.push(...this.buildWorkerCallLines(validatesCalls, reportInvalid));
      }
      if (sends.length > 0) {
         out.push(...this.buildWorkerSendLines(validatesSends, reportInvalid));
      }
      if (asks.length > 0) {
         out.push(
            "function answerWorkerAsk(hub: WorkerHub, versionId: number, info: WorkerChannelInfo, id: unknown, envelope: unknown): void {",
            `${i1}const pending = typeof id === 'number' ? hub.asks[id] : undefined;`,
            `${i1}if (pending && pending.channel === info.channel && pending.versionId === versionId) {`,
            `${i2}pending.answer(envelope);`,
            `${i1}}`,
            "}",
            "",
            "function failWorkerAsks(hub: WorkerHub, versionId: number): void {",
            `${i1}for (const pending of Object.values(hub.asks)) {`,
            `${i2}if (pending && pending.versionId === versionId) {`,
            `${i3}pending.fail(new IpcAskError(pending.channel, \`The service worker that was asked on the channel '\${pending.channel}' has stopped\`, 'IPC_ASK_DESTROYED'));`,
            `${i2}}`,
            `${i1}}`,
            "}",
            "",
            "function askServiceWorker(",
            `${i1}channel: string,`,
            `${i1}wire: string,`,
            `${i1}worker: ServiceWorkerMain,`,
            `${i1}args: unknown[],`,
            `${i1}options?: IpcAskOptions,`,
            "): Promise<unknown> {",
            `${i1}return new Promise<unknown>((resolve, reject) => {`,
            `${i2}const timeoutMs = options?.timeoutMs;`,
            `${i2}if (timeoutMs !== undefined && !(typeof timeoutMs === 'number' && timeoutMs >= 0)) {`,
            `${i3}throw new TypeError('timeoutMs must be a number which is not negative');`,
            `${i2}}`,
            `${i2}const hub = workerHubs.get(worker);`,
            `${i2}if (!hub) {`,
            `${i3}reject(new IpcAskError(channel, 'The service worker is not known to the bindings. Call attachServiceWorkers(session) for its session first', 'IPC_ASK_NOT_ATTACHED'));`,
            `${i3}return;`,
            `${i2}}`,
            `${i2}const destroyed = new IpcAskError(channel, \`The service worker that was asked on the channel '\${channel}' is gone\`, 'IPC_ASK_DESTROYED');`,
            `${i2}let versionId = 0;`,
            `${i2}let isGone = false;`,
            `${i2}try {`,
            `${i3}isGone = worker.isDestroyed();`,
            `${i3}versionId = worker.versionId;`,
            `${i2}} catch {`,
            `${i3}isGone = true;`,
            `${i2}}`,
            `${i2}if (isGone) {`,
            `${i3}reject(destroyed);`,
            `${i3}return;`,
            `${i2}}`,
            `${i2}const id = ++lastWorkerAskId;`,
            `${i2}let timer: ReturnType<typeof setTimeout> | undefined;`,
            `${i2}let task: { end: () => void } | undefined;`,
            `${i2}const finish = (settle: () => void): void => {`,
            `${i3}clearTimeout(timer);`,
            `${i3}delete hub.asks[id];`,
            `${i3}try {`,
            `${i4}task?.end();`,
            `${i3}} catch {`,
            `${i4}// The worker is gone, and so is its task.`,
            `${i3}}`,
            `${i3}settle();`,
            `${i2}};`,
            `${i2}hub.asks[id] = {`,
            `${i3}channel,`,
            `${i3}versionId,`,
            `${i3}answer: (envelope) => {`,
            ...(this.usesSerializer()
               ? [
                    `${i4}let outcome = readAskReply(channel, envelope, 'service worker');`,
                    `${i4}if (!('error' in outcome)) {`,
                    `${i4}${i1}try {`,
                    `${i4}${i2}outcome = { value: decodeValue(channel, outcome.value) };`,
                    `${i4}${i1}} catch (cause) {`,
                    `${i4}${i2}outcome = { error: new IpcAskError(channel, \`The answer cannot be read: \${cause instanceof Error ? cause.message : String(cause)}\`, 'IPC_ASK_INVALID_REPLY') };`,
                    `${i4}${i1}}`,
                    `${i4}}`,
                    `${i4}const settled = outcome;`,
                 ]
               : [`${i4}const settled = readAskReply(channel, envelope, 'service worker');`]),
            `${i4}finish(() => ('error' in settled ? reject(settled.error) : resolve(settled.value)));`,
            `${i3}},`,
            `${i3}fail: (error) => finish(() => reject(error)),`,
            `${i2}};`,
            `${i2}if (timeoutMs !== undefined && timeoutMs !== Infinity) {`,
            `${i3}const error = new IpcAskError(channel, \`The service worker did not answer the channel '\${channel}' within \${timeoutMs} ms\`, 'IPC_ASK_TIMEOUT');`,
            `${i3}timer = setTimeout(() => finish(() => reject(error)), Math.min(timeoutMs, 2147483647));`,
            `${i2}}`,
            `${i2}try {`,
            ...(this.usesSerializer() ? [`${i3}const question = encodeValue(channel, args);`] : []),
            `${i3}// Keeps the worker from stopping while it is asked.`,
            `${i3}task = worker.startTask();`,
            `${i3}worker.send(wire, id, ${this.usesSerializer() ? "question" : "...args"});`,
            `${i2}} catch (error) {`,
            `${i3}finish(() => reject(error));`,
            `${i2}}`,
            `${i1}});`,
            "}",
            "",
         );
      }
      if (times) {
         out.push(...this.buildWorkerTimer());
      }
      out.push(this.buildWorkerRouting(calls, sends, asks, times));
      out.push(...this.buildWorkerSenders(specs));
      return out.join("\n");
   }
   /** `getWorkerOrigin` and `isWorkerAllowed`, which the routes call first. */
   private buildWorkerSenderCheck(events: string, validates: boolean): string[] {
      const [i1, i2, i3] = this.indents;
      return [
         "function getWorkerOrigin(scope: string): string | null {",
         `${i1}try {`,
         `${i2}const url = new URL(scope);`,
         `${i2}// The origin of a scheme that is not special is "null", while a frame reports scheme://host.`,
         `${i2}return url.origin !== 'null' ? url.origin : \`\${url.protocol}//\${url.host}\`;`,
         `${i1}} catch {`,
         `${i2}return null;`,
         `${i1}}`,
         "}",
         "",
         `function isWorkerAllowed(worker: ServiceWorkerMain, event: ${events}, channel: string, allowedOrigins?: string[]): boolean {`,
         `${i1}const validateSender = workerConfig.validateSender;`,
         `${i1}if (!allowedOrigins && !validateSender) {`,
         `${i2}return true;`,
         `${i1}}`,
         `${i1}let allowed = false;`,
         `${i1}try {`,
         `${i2}const origin = getWorkerOrigin(worker.scope);`,
         `${i2}allowed =`,
         `${i3}(!allowedOrigins || (origin !== null && allowedOrigins.includes(origin))) &&`,
         `${i3}(!validateSender || validateSender(event, channel) === true);`,
         `${i1}} catch {`,
         `${i2}allowed = false;`,
         `${i1}}`,
         `${i1}if (!allowed && workerConfig.onRejected) {`,
         `${i2}try {`,
         validates
            ? `${i3}workerConfig.onRejected(event, channel, new IpcWorkerError(channel, \`The service worker is not allowed to use the channel '\${channel}'\`, 'IPC_WORKER_FORBIDDEN'));`
            : `${i3}workerConfig.onRejected(event, channel);`,
         `${i2}} catch {`,
         `${i3}// A failing hook must not decide whether the call is rejected.`,
         `${i2}}`,
         `${i1}}`,
         `${i1}return allowed;`,
         "}",
         "",
      ];
   }
   /**
    * `timeWorkerCall`, which rejects the call of a worker that the handler has not answered in time.
    * The preload script of a worker has no timers, so the main process times its calls. The error is
    * answered in the envelope, so it reaches the worker as the plain object `{ name:
    * 'IpcTimeoutError', message, code: 'IPC_TIMEOUT' }`, like the timeout of a page. The handler is not
    * stopped, and its late reply is dropped. The timer is cleared as soon as the handler settles.
    */
   private buildWorkerTimer(): string[] {
      const [i1, i2, i3] = this.indents;
      return [
         "function timeWorkerCall(info: WorkerChannelInfo, result: unknown): unknown {",
         `${i1}const timeoutMs = info.timeoutMs;`,
         `${i1}if (!timeoutMs || !result || typeof (result as Promise<unknown>).then !== 'function') {`,
         `${i2}return result;`,
         `${i1}}`,
         `${i1}return new Promise<unknown>((resolve, reject) => {`,
         `${i2}const timer = setTimeout(() => {`,
         `${i3}const message = \`The channel '\${info.channel}' did not answer within \${timeoutMs} ms\`;`,
         `${i3}reject(Object.assign(new Error(message), { name: 'IpcTimeoutError', code: 'IPC_TIMEOUT' }));`,
         `${i2}}, Math.min(timeoutMs, 2147483647));`,
         `${i2}(result as Promise<unknown>).then(`,
         `${i3}(value) => {`,
         `${i3}${i1}clearTimeout(timer);`,
         `${i3}${i1}resolve(value);`,
         `${i3}},`,
         `${i3}(error: unknown) => {`,
         `${i3}${i1}clearTimeout(timer);`,
         `${i3}${i1}reject(error);`,
         `${i3}},`,
         `${i2});`,
         `${i1}});`,
         "}",
         "",
      ];
   }
   /** `IpcWorkerConfig`, `configureServiceWorkerIpc` and the type of the entries of the tables of channels. */
   private buildWorkerConfigLines(w: {
      inbound: boolean;
      events: string;
      hasAsks: boolean;
      validates: boolean;
      times: boolean;
   }): string[] {
      const [i1] = this.indents;
      const { events, validates, times } = w;
      if (w.inbound) {
         return [
            "export interface IpcWorkerConfig {",
            `${i1}validateSender?: (event: ${events}, channel: string) => boolean;`,
            `${i1}onRejected?: (event: ${events}, channel: string${validates ? ", error: IpcWorkerError | IpcValidationError" : ""}) => void;`,
            "}",
            "",
            "let workerConfig: IpcWorkerConfig = {};",
            "",
            "export function configureServiceWorkerIpc(config: IpcWorkerConfig): void {",
            `${i1}workerConfig = { validateSender: config.validateSender, onRejected: config.onRejected };`,
            "}",
            "",
            "interface WorkerChannelInfo {",
            `${i1}channel: string;`,
            `${i1}wire: string;`,
            `${i1}allowedOrigins?: string[];`,
            ...(validates ? [`${i1}validator?: IpcArgumentsSchema;`] : []),
            ...(times ? [`${i1}timeoutMs?: number;`] : []),
            "}",
            "",
         ];
      }
      return w.hasAsks
         ? ["interface WorkerChannelInfo {", `${i1}channel: string;`, `${i1}wire: string;`, "}", ""]
         : [];
   }
   /** The line of a channel in the table of the channels that a hub routes. */
   private describeWorkerChannel(spec: t.ChannelSpec, wire: string, validator?: string): string {
      const origins = spec.allowedOrigins
         ? `, allowedOrigins: [${spec.allowedOrigins.map((origin) => JSON.stringify(origin)).join(", ")}]`
         : "";
      const validated = validator === undefined ? "" : `, validator: ${validator}`;
      const timeoutMs = spec.direction === "ServiceWorkerToMain" ? this.getTimeoutMs(spec) : 0;
      const timed = timeoutMs > 0 && spec.kind === "Unicast" ? `, timeoutMs: ${timeoutMs}` : "";
      return `${this.indents[0]}{ channel: '${spec.name}', wire: ${wire}${origins}${validated}${timed} },`;
   }
   /** `callWorkerHandler` and the registration of the handlers of the calls of a worker, with the validation of the arguments if a channel has a validator. */
   private buildWorkerCallLines(validated: boolean, reportInvalid: string): string[] {
      const [i1, i2, i3] = this.indents;
      const serialized = this.usesSerializer();
      return [
         "function callWorkerHandler(",
         `${i1}hub: WorkerHub,`,
         `${i1}worker: ServiceWorkerMain,`,
         `${i1}event: IpcMainServiceWorkerInvokeEvent,`,
         `${i1}info: WorkerChannelInfo,`,
         `${i1}args: unknown[],`,
         "): unknown {",
         `${i1}if (!isWorkerAllowed(worker, event, info.channel, info.allowedOrigins)) {`,
         `${i2}throw new IpcWorkerError(info.channel, \`The service worker is not allowed to use the channel '\${info.channel}'\`, 'IPC_WORKER_FORBIDDEN');`,
         `${i1}}`,
         ...(validated
            ? [
                 `${i1}const missing = () => new IpcWorkerError(info.channel, \`No handler is registered for the channel '\${info.channel}'\`, 'IPC_WORKER_NO_HANDLER');`,
                 `${i1}if (!hub.handlers[info.channel]) {`,
                 `${i2}throw missing();`,
                 `${i1}}`,
                 ...(serialized
                    ? [
                         `${i1}// The sender is checked first, so that a rejected worker reaches no code of the serializer.`,
                         `${i1}const decoded = readArguments(info.channel, args);`,
                      ]
                    : []),
                 `${i1}// The handler is looked up when the arguments are valid, since a schema may take its time`,
                 `${i1}// and a handler of \`handleOnce\` may have been used up by then.`,
                 `${i1}const run = (valid: unknown[]): unknown => {`,
                 `${i2}const handler = hub.handlers[info.channel] as ((...handlerArgs: unknown[]) => unknown) | undefined;`,
                 `${i2}if (!handler) {`,
                 `${i3}throw missing();`,
                 `${i2}}`,
                 `${i2}return handler(event, ...valid);`,
                 `${i1}};`,
                 `${i1}return info.validator`,
                 `${i2}? validateArguments(event, info.channel, info.validator, ${serialized ? "decoded" : "args"}, false, run, ${reportInvalid})`,
                 `${i2}: run(${serialized ? "decoded" : "args"});`,
              ]
            : [
                 `${i1}const handler = hub.handlers[info.channel] as ((...handlerArgs: unknown[]) => unknown) | undefined;`,
                 `${i1}if (!handler) {`,
                 `${i2}throw new IpcWorkerError(info.channel, \`No handler is registered for the channel '\${info.channel}'\`, 'IPC_WORKER_NO_HANDLER');`,
                 `${i1}}`,
                 `${i1}return handler(event, ...${serialized ? "readArguments(info.channel, args)" : "args"});`,
              ]),
         "}",
         "",
         "function registerWorkerHandler(session: Session, channel: string, callback: unknown, once: boolean): () => void {",
         `${i1}const hub = getWorkerHub(session);`,
         `${i1}const handler = once`,
         `${i2}? (event: unknown, ...args: unknown[]) => {`,
         `${i3}remove();`,
         `${i3}return (callback as (...handlerArgs: unknown[]) => unknown)(event, ...args);`,
         `${i2}}`,
         `${i2}: callback;`,
         `${i1}const remove = (): void => {`,
         `${i2}if (hub.handlers[channel] === handler) {`,
         `${i3}delete hub.handlers[channel];`,
         `${i2}}`,
         `${i1}};`,
         `${i1}hub.handlers[channel] = handler;`,
         `${i1}return remove;`,
         "}",
         "",
      ];
   }
   /** `dispatchWorkerSend` and the registration of the listeners of the messages of a worker, with the validation of the arguments if a channel has a validator. */
   private buildWorkerSendLines(validated: boolean, reportInvalid: string): string[] {
      const [i1, i2, i3, i4] = this.indents;
      const serialized = this.usesSerializer();
      // A message that cannot be read is logged and dropped, and does not use up a `once` listener.
      const decode = (name: string): string[] =>
         serialized
            ? [
                 `${i1}const ${name} = readSentArguments(info.channel, args);`,
                 `${i1}if (!${name}) {`,
                 `${i2}return;`,
                 `${i1}}`,
              ]
            : [];
      return [
         "function dispatchWorkerSend(",
         `${i1}hub: WorkerHub,`,
         `${i1}worker: ServiceWorkerMain,`,
         `${i1}event: IpcMainServiceWorkerEvent,`,
         `${i1}info: WorkerChannelInfo,`,
         `${i1}args: unknown[],`,
         "): void {",
         `${i1}if (!isWorkerAllowed(worker, event, info.channel, info.allowedOrigins)) {`,
         `${i2}return;`,
         `${i1}}`,
         ...(validated
            ? [
                 `${i1}if (!hub.listeners[info.channel]) {`,
                 `${i2}return;`,
                 `${i1}}`,
                 ...decode("decoded"),
                 `${i1}// The listeners are looked up when the arguments are valid, since a schema may take its time`,
                 `${i1}// and a listener of \`once\` may have been used up by then.`,
                 `${i1}const run = (valid: unknown[]): void => {`,
                 `${i2}const listeners = hub.listeners[info.channel];`,
                 `${i2}if (!listeners) {`,
                 `${i3}return;`,
                 `${i2}}`,
                 `${i2}for (const entry of listeners.slice()) {`,
                 `${i3}if (entry.once) {`,
                 `${i4}const at = listeners.indexOf(entry);`,
                 `${i4}if (at < 0) {`,
                 `${i4}${i1}continue;`,
                 `${i4}}`,
                 `${i4}listeners.splice(at, 1);`,
                 `${i3}}`,
                 `${i3}try {`,
                 `${i4}(entry.callback as (...listenerArgs: unknown[]) => unknown)(event, ...valid);`,
                 `${i3}} catch (error) {`,
                 `${i4}console.error(error);`,
                 `${i3}}`,
                 `${i2}}`,
                 `${i1}};`,
                 `${i1}if (info.validator) {`,
                 `${i2}void validateArguments(event, info.channel, info.validator, ${serialized ? "decoded" : "args"}, true, run, ${reportInvalid});`,
                 `${i1}} else {`,
                 `${i2}run(${serialized ? "decoded" : "args"});`,
                 `${i1}}`,
              ]
            : [
                 `${i1}const listeners = hub.listeners[info.channel];`,
                 `${i1}if (!listeners) {`,
                 `${i2}return;`,
                 `${i1}}`,
                 ...decode("decoded"),
                 `${i1}for (const entry of listeners.slice()) {`,
                 `${i2}if (entry.once) {`,
                 `${i3}const at = listeners.indexOf(entry);`,
                 `${i3}if (at < 0) {`,
                 `${i4}continue;`,
                 `${i3}}`,
                 `${i3}listeners.splice(at, 1);`,
                 `${i2}}`,
                 `${i2}try {`,
                 `${i3}(entry.callback as (...listenerArgs: unknown[]) => unknown)(event, ...${serialized ? "decoded" : "args"});`,
                 `${i2}} catch (error) {`,
                 `${i3}console.error(error);`,
                 `${i2}}`,
                 `${i1}}`,
              ]),
         "}",
         "",
         "function addWorkerListener(session: Session, channel: string, callback: unknown, once: boolean): () => void {",
         `${i1}const hub = getWorkerHub(session);`,
         `${i1}const entry: WorkerListener = { callback, once };`,
         `${i1}const listeners = hub.listeners[channel] ?? [];`,
         `${i1}listeners.push(entry);`,
         `${i1}hub.listeners[channel] = listeners;`,
         `${i1}return () => {`,
         `${i2}const at = listeners.indexOf(entry);`,
         `${i2}if (at >= 0) {`,
         `${i3}listeners.splice(at, 1);`,
         `${i2}}`,
         `${i1}};`,
         "}",
         "",
      ];
   }
   /** `routeWorker`, `getWorkerHub` and `attachServiceWorkers`, which connect the hubs to the workers. */
   private buildWorkerRouting(
      calls: t.ChannelSpec[],
      sends: t.ChannelSpec[],
      asks: t.ChannelSpec[],
      times: boolean,
   ): string {
      const [i1, i2, i3, i4] = this.indents;
      const route: string[] = [];
      if (calls.length > 0) {
         const call = "callWorkerHandler(hub, worker, event, info, args)";
         const timed = times ? `timeWorkerCall(info, ${call})` : call;
         // A serialized result is encoded once the handler has answered in time.
         const result = this.usesSerializer() ? `encodeValue(info.channel, await ${timed})` : timed;
         const params = "event: IpcMainServiceWorkerInvokeEvent, ...args: unknown[]";
         const settle = this.usesSerializer() ? `async () => ${result}` : `() => ${timed}`;
         route.push(
            `${i1}for (const info of workerCalls) {`,
            this.config.rawErrors
               ? this.usesSerializer()
                  ? `${i2}worker.ipc.handle(info.wire, async (${params}) =>`
                  : `${i2}worker.ipc.handle(info.wire, (${params}) =>`
               : `${i2}worker.ipc.handle(info.wire, (${params}) =>`,
            this.config.rawErrors ? `${i3}${result},` : `${i3}settleInvoke(${settle}),`,
            `${i2});`,
            `${i1}}`,
         );
      }
      if (sends.length > 0) {
         route.push(
            `${i1}for (const info of workerSends) {`,
            `${i2}worker.ipc.on(info.wire, (event: IpcMainServiceWorkerEvent, ...args: unknown[]) =>`,
            `${i3}dispatchWorkerSend(hub, worker, event, info, args),`,
            `${i2});`,
            `${i1}}`,
         );
      }
      if (asks.length > 0) {
         route.push(
            `${i1}const versionId = worker.versionId;`,
            `${i1}for (const info of workerAsks) {`,
            `${i2}worker.ipc.on(info.wire, (_event: unknown, id: unknown, envelope: unknown) =>`,
            `${i3}answerWorkerAsk(hub, versionId, info, id, envelope),`,
            `${i2});`,
            `${i1}}`,
         );
      }
      return [
         "function routeWorker(hub: WorkerHub, worker: ServiceWorkerMain): void {",
         `${i1}if (workerHubs.has(worker)) {`,
         `${i2}return;`,
         `${i1}}`,
         `${i1}workerHubs.set(worker, hub);`,
         ...route,
         "}",
         "",
         "function getWorkerHub(session: Session): WorkerHub {",
         `${i1}const known = sessionHubs.get(session);`,
         `${i1}if (known) {`,
         `${i2}return known;`,
         `${i1}}`,
         `${i1}const hub: WorkerHub = {`,
         ...(calls.length > 0
            ? [`${i2}handlers: { __proto__: null } as unknown as WorkerHub['handlers'],`]
            : []),
         ...(sends.length > 0
            ? [`${i2}listeners: { __proto__: null } as unknown as WorkerHub['listeners'],`]
            : []),
         ...(asks.length > 0
            ? [`${i2}asks: { __proto__: null } as unknown as WorkerHub['asks'],`]
            : []),
         `${i1}};`,
         `${i1}sessionHubs.set(session, hub);`,
         `${i1}const serviceWorkers = session.serviceWorkers;`,
         `${i1}const route = (versionId: number): void => {`,
         `${i2}try {`,
         `${i3}const worker = serviceWorkers.getWorkerFromVersionID(versionId);`,
         `${i3}if (worker) {`,
         `${i4}routeWorker(hub, worker);`,
         `${i3}}`,
         `${i2}} catch (error) {`,
         `${i3}console.error(error);`,
         `${i2}}`,
         `${i1}};`,
         `${i1}serviceWorkers.on('running-status-changed', (details) => {`,
         `${i2}if (details.runningStatus === 'starting' || details.runningStatus === 'running') {`,
         `${i3}route(details.versionId);`,
         ...(asks.length > 0
            ? [
                 `${i2}} else {`,
                 `${i3}// A worker that is stopping cannot answer any more.`,
                 `${i3}failWorkerAsks(hub, details.versionId);`,
              ]
            : []),
         `${i2}}`,
         `${i1}});`,
         `${i1}for (const id of Object.keys(serviceWorkers.getAllRunning())) {`,
         `${i2}route(Number(id));`,
         `${i1}}`,
         `${i1}return hub;`,
         "}",
         "",
         "/**",
         " * Starts watching the service workers of the session, so that the messages of a worker are",
         " * routed from its first line on. `handle` and `on` do this as well, and a question to a worker",
         " * (`invoke`) needs it. Call it with `session.defaultSession`, or the session of the window.",
         " */",
         "export function attachServiceWorkers(session: Session): void {",
         `${i1}getWorkerHub(session);`,
         "}",
         "",
      ].join("\n");
   }
   /** `sendToWorker` and `broadcastToWorkers`, which the `send` and `broadcast` of the channels to a worker call. */
   private buildWorkerSenders(specs: t.ChannelSpec[]): string[] {
      const [i1, i2, i3] = this.indents;
      if (
         !specs.some(
            (spec) => spec.direction === "MainToServiceWorker" && spec.kind === "Broadcast",
         )
      ) {
         return [];
      }
      return [
         "function sendToWorker(channel: string, wire: string, worker: ServiceWorkerMain, args: unknown[]): void {",
         `${i1}if (worker.isDestroyed()) {`,
         `${i2}throw new IpcWorkerError(channel, \`The service worker that the channel '\${channel}' was sent to is gone\`, 'IPC_WORKER_DESTROYED');`,
         `${i1}}`,
         `${i1}worker.send(wire, ...args);`,
         "}",
         "",
         "function broadcastToWorkers(wire: string, session: Session, args: unknown[]): void {",
         `${i1}const serviceWorkers = session.serviceWorkers;`,
         `${i1}for (const id of Object.keys(serviceWorkers.getAllRunning())) {`,
         `${i2}try {`,
         `${i3}const worker = serviceWorkers.getWorkerFromVersionID(Number(id));`,
         `${i3}if (worker && !worker.isDestroyed()) {`,
         `${i3}${i1}worker.send(wire, ...args);`,
         `${i3}}`,
         `${i2}} catch (error) {`,
         `${i3}console.error(error);`,
         `${i2}}`,
         `${i1}}`,
         "}",
         "",
      ];
   }
   /**
    * `handle(session, callback)` and `handleOnce` of an `invokeFromWorker` channel, `on(session,
    * callback)` and `once` of a `sendFromWorker` channel, `send(worker, ...args)` and
    * `broadcast(session, ...args)` of an `emitToWorker` channel, and `invoke(worker, ...args)` and
    * `invokeWith(worker, { timeoutMs }, ...args)` of an `askWorker` channel.
    */
   private buildWorkerChannel(spec: t.ChannelSpec): ChannelEntry {
      const [, i1, i2] = this.indents;
      // The names of the generated parameters must not shadow a parameter of the signature.
      const taken = this.collectIdentifiers([spec.signature.definition]);
      const sessionName = this.uniqueName("session", taken);
      const workerName = this.uniqueName("worker", taken);
      const callbackName = this.uniqueName("callback", taken);
      const optionsName = this.uniqueName("options", taken);
      const eventName = this.uniqueName("event", taken);
      const channel = `'${spec.name}'`;
      const wire = this.wireName(spec.name);
      const typeParams = this.getTypeParams(spec.signature);
      const params = (...generated: string[]) =>
         [...generated, this.getOriginalParams(spec, false)].filter(Boolean).join(", ");
      const senderParams = this.getOriginalParams(spec, true);
      // A serialized message is one argument, the list of the arguments, as the serializer made it.
      const serialized = this.usesSerializer();
      const wired = serialized ? `encodeValue('${spec.name}', [${senderParams}])` : senderParams;
      const rest = serialized ? `[${wired}]` : senderParams ? `[${senderParams}]` : "[]";
      // A question is serialized by `askServiceWorker`, so that a failure rejects the promise.
      const askArgs = senderParams ? `[${senderParams}]` : "[]";
      if (spec.direction === "ServiceWorkerToMain") {
         const eventType = this.getWorkerEventType(spec);
         const signature = this.injectEventTypehint(spec.signature, eventType, eventName);
         const callback = `${callbackName}: ${signature}`;
         const methods =
            spec.kind === "Broadcast"
               ? [
                    ["on", "addWorkerListener", false],
                    ["once", "addWorkerListener", true],
                 ]
               : [
                    ["handle", "registerWorkerHandler", false],
                    ["handleOnce", "registerWorkerHandler", true],
                 ];
         return {
            name: spec.name,
            members: methods.flatMap(([method, helper, once]) => [
               `\n${i1}${method}: (${sessionName}: Session, ${callback}): (() => void) =>`,
               `\n${i2}${helper}(${sessionName}, ${channel}, ${callbackName}, ${once}),`,
            ]),
         };
      }
      if (spec.kind === "Broadcast") {
         return {
            name: spec.name,
            members: [
               `\n${i1}send: ${typeParams}(${params(`${workerName}: ServiceWorkerMain`)}): void =>`,
               `\n${i2}sendToWorker(${channel}, ${wire}, ${workerName}, ${rest}),`,
               `\n${i1}broadcast: ${typeParams}(${params(`${sessionName}: Session`)}): void =>`,
               `\n${i2}broadcastToWorkers(${wire}, ${sessionName}, ${rest}),`,
            ],
         };
      }
      const returned = spec.signature.async
         ? spec.signature.returnType
         : `Promise<Awaited<${spec.signature.returnType}>>`;
      const ask = (options: string) =>
         `askServiceWorker(${channel}, ${wire}, ${workerName}, ${askArgs}${options}) as ${returned}`;
      return {
         name: spec.name,
         members: [
            `\n${i1}invoke: ${typeParams}(${params(`${workerName}: ServiceWorkerMain`)}): ${returned} =>`,
            `\n${i2}${ask("")},`,
            `\n${i1}invokeWith: ${typeParams}(${params(`${workerName}: ServiceWorkerMain`, `${optionsName}: IpcAskOptions`)}): ${returned} =>`,
            `\n${i2}${ask(`, ${optionsName}`)},`,
         ],
      };
   }
}
