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
import { hasScopedGuards } from "./main-registries.js";
import { buildRendererToMainChannel, getEventType, hasEnvelope } from "./main-renderer-channels.js";
import { buildMainToRendererChannel, getSenderTypes } from "./main-senders.js";
import { buildSupport } from "./main-support.js";
import { importValidator } from "./main-validation.js";
import { buildUtilityPeer, UTILITY_RUNTIME_NAMES } from "./utility-runtime.js";

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

/** The electron types that the helpers of the channels between a renderer and a utility process use. */
const BROKER_TYPES = ["BrowserWindow", "WebContents", "WebContentsView", "UtilityProcess"];

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
               channels.push(this.buildPort(spec, electronImportsSet, electronTypeImportsSet));
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
            utilityHelpers: () => this.buildUtilityHelpers(),
            portRegistry: () => this.buildPortRegistry(),
            pageLoadWatch: () => this.buildPageLoadWatch(),
            brokerHelpers: () => this.buildBrokerHelpers(),
            portHelpers: () => this.buildPortHelpers(),
            mainPortHelpers: () => this.buildMainPortHelpers(),
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
         return [this.buildUtilityChannel(spec)];
      } else if (this.isBrokeredSpec(spec)) {
         // The page is connected to a child which the peers know, so that its exit is seen (T86).
         uses.utility = true;
         uses.envelope = true;
         uses.brokers = true;
         values.add("utilityProcess");
         types.add("UtilityProcess");
         return [this.buildBrokeredChannel(spec, values, types)];
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
   /** Builds a port channel, and adds the electron imports that its helpers use. */
   private buildPort(spec: t.ChannelSpec, values: Set<string>, types: Set<string>): ChannelEntry {
      values.add("MessageChannelMain");
      for (const type of this.getPortTypes(spec)) {
         types.add(type);
      }
      return spec.direction === "MainToRenderer"
         ? this.buildMainPortChannel(spec)
         : this.buildPortChannel(spec);
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
   /** The electron types that the helpers of a port channel use. */
   private getPortTypes(spec: t.ChannelSpec): string[] {
      const types = ["BrowserWindow", "IpcMainEvent", "WebContents"];
      return spec.direction === "MainToRenderer"
         ? [...types, "WebContentsView", "MessagePortMain"]
         : types;
   }
   /**
    * The registry of the ends of connections, which both kinds of port channel use. Every end of a
    * connection has a key: the message that carries its port, and the one that closes it. A page
    * tells the keys apart, so it can hold any number of connections of a channel, and replaces the
    * port of the one that is paired again. A page ends a connection through `<channel>:disconnect`,
    * which is honoured only from the contents that hold that end. The main process no longer holds
    * the ports that it has transferred, so it tells the pages through `<channel>:close` when a
    * connection ends.
    */
   private buildPortRegistry(): string {
      const [i1, i2, i3] = this.indents;
      return [
         "",
         "let lastPortConnectionId = 0;",
         "const portEnds = new Map<string, { contents: WebContents; close: () => void }>();",
         "const portDisconnectChannels = new Set<string>();",
         "",
         "function listenForPortDisconnects(channel: string): void {",
         `${i1}if (portDisconnectChannels.has(channel)) {`,
         `${i2}return;`,
         `${i1}}`,
         `${i1}portDisconnectChannels.add(channel);`,
         `${i1}electronIpcMain.on(\`\${channel}:disconnect\`, (event: IpcMainEvent, key: unknown) => {`,
         `${i2}const end = typeof key === 'string' ? portEnds.get(key) : undefined;`,
         `${i2}if (end && !end.contents.isDestroyed() && end.contents === event.sender) {`,
         `${i3}end.close();`,
         `${i2}}`,
         `${i1}});`,
         "}",
         "",
      ].join("\n");
   }
   /**
    * `watchPageLoad` tells when the page of some contents has loaded, which a port has to wait for,
    * since one that is posted earlier arrives before the preload script listens for it. It cannot
    * ask `isLoading()`: Electron keeps it `true` while `did-finish-load` fires, and after
    * `loadURL` has resolved, until `did-stop-loading`. So the page counts as loaded from every
    * `did-finish-load`, and from the `did-stop-loading` of a load that `did-finish-load` has not
    * reported, such as one that finished before the watch began. A failed main-frame load does not
    * count, nor does the error page that Electron shows for it. The exception is ERR_ABORTED (-3)
    * after a commit, such as `stop()` while the new document loads: it shows no error page and the
    * document that committed is there, so the `did-stop-loading` that follows counts as its load.
    * The state of the load resets only when a main-frame navigation commits (`did-navigate`), so
    * one that never commits changes nothing. The events are watched through `watchEvent`, so any number of watches of the same
    * contents adds one listener of each event. `onLoad` runs once per load, and the watch starts
    * out loaded if the contents have a page and are not loading.
    */
   private buildPageLoadWatch(): string {
      const [i1, i2, i3, i4] = this.indents;
      return [
         "",
         "interface PageLoadWatch {",
         `${i1}isLoaded: () => boolean;`,
         `${i1}dispose: () => void;`,
         "}",
         "",
         "function watchPageLoad(contents: WebContents, onLoad: () => void): PageLoadWatch {",
         `${i1}let loaded = !contents.isDestroyed() && !contents.isLoading() && contents.getURL() !== '';`,
         `${i1}// Whether the load that is going on has been reported already.`,
         `${i1}let settled = !contents.isDestroyed() && !contents.isLoading();`,
         `${i1}let failed = false;`,
         `${i1}// Whether a main-frame navigation has committed since the watch began.`,
         `${i1}let committed = false;`,
         `${i1}// A main-frame navigation that commits replaces the document. One that starts and stops`,
         `${i1}// without a commit (a prevented one, a download, a 204 response) leaves the page as it was.`,
         `${i1}const commit = () => {`,
         `${i2}loaded = false;`,
         `${i2}settled = false;`,
         `${i2}failed = false;`,
         `${i2}committed = true;`,
         `${i1}};`,
         `${i1}// A failed load ends in the error page of Electron, which fires its own did-finish-load.`,
         `${i1}// ERR_ABORTED (-3) shows no error page, so the page that was loaded stays loaded. When it`,
         `${i1}// follows a commit, the document that committed is the page, and it loaded as far as it got.`,
         `${i1}const fail = (_event: unknown, code: number, _description: string, _url: string, isMainFrame: boolean) => {`,
         `${i2}if (!isMainFrame) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}if (code !== -3) {`,
         `${i3}failed = true;`,
         `${i3}loaded = false;`,
         `${i2}} else if (!committed) {`,
         `${i3}failed = true;`,
         `${i2}}`,
         `${i1}};`,
         `${i1}const finish = () => {`,
         `${i2}if (failed) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}loaded = true;`,
         `${i2}settled = true;`,
         `${i2}onLoad();`,
         `${i1}};`,
         `${i1}const stop = () => {`,
         `${i2}if (!settled && !failed) {`,
         `${i3}finish();`,
         `${i2}}`,
         `${i1}};`,
         `${i1}const stops = [`,
         `${i2}watchEvent(contents, 'did-navigate', commit),`,
         `${i2}watchEvent(contents, 'did-fail-load', fail),`,
         `${i2}watchEvent(contents, 'did-finish-load', finish),`,
         `${i2}watchEvent(contents, 'did-stop-loading', stop),`,
         `${i1}];`,
         `${i1}return {`,
         `${i2}isLoaded: () => loaded,`,
         `${i2}dispose: () => {`,
         `${i3}for (const unwatch of stops) {`,
         `${i4}unwatch();`,
         `${i3}}`,
         `${i2}},`,
         `${i1}};`,
         "}",
         "",
      ].join("\n");
   }
   /**
    * `connectPorts`, which `ipc.<name>.connect` calls. A pair of ports is made only when both
    * windows have loaded their page (see `watchPageLoad`), since a port that is posted earlier
    * arrives before the preload script listens for it. It is made right away if both have, and
    * again whenever a page loads, so a window that is shown late and a page that reloads get a fresh port, and
    * the other window replaces its end. The connection ends when it is closed and when either
    * window is destroyed. Both windows are resolved before anything is registered, so a destroyed
    * window makes `connect` throw Electron's own error and leaves nothing behind, and a setup step
    * that fails later undoes what was registered.
    */
   private buildPortHelpers(): string {
      const [i1, i2, i3, i4] = this.indents;
      return [
         "",
         "function connectPorts(channel: string, winA: BrowserWindow, winB: BrowserWindow): { close: () => void } {",
         `${i1}const id = ++lastPortConnectionId;`,
         `${i1}// Both windows are resolved before anything is registered: the getter of a destroyed window throws.`,
         `${i1}const ends = [`,
         `${i2}{ key: \`\${id}:a\`, win: winA, contents: winA.webContents },`,
         `${i2}{ key: \`\${id}:b\`, win: winB, contents: winB.webContents },`,
         `${i1}];`,
         `${i1}const watched = winA === winB ? [ends[0]] : ends;`,
         `${i1}let closed = false;`,
         `${i1}const watches = new Map<BrowserWindow, PageLoadWatch>();`,
         `${i1}const unwatchClosed: (() => void)[] = [];`,
         `${i1}const isReady = (win: BrowserWindow) => !win.isDestroyed() && !!watches.get(win)?.isLoaded();`,
         `${i1}const pair = () => {`,
         `${i2}if (closed || !isReady(winA) || !isReady(winB)) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}const { port1, port2 } = new MessageChannelMain();`,
         `${i2}ends[0].contents.postMessage(channel, ends[0].key, [port1]);`,
         `${i2}ends[1].contents.postMessage(channel, ends[1].key, [port2]);`,
         `${i1}};`,
         `${i1}const close = () => {`,
         `${i2}if (closed) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}closed = true;`,
         `${i2}for (const end of watched) {`,
         `${i3}watches.get(end.win)?.dispose();`,
         `${i2}}`,
         `${i2}for (const unwatch of unwatchClosed.splice(0)) {`,
         `${i3}unwatch();`,
         `${i2}}`,
         `${i2}for (const end of ends) {`,
         `${i3}portEnds.delete(end.key);`,
         `${i3}if (!end.win.isDestroyed()) {`,
         `${i4}end.contents.send(\`\${channel}:close\`, end.key);`,
         `${i3}}`,
         `${i2}}`,
         `${i1}};`,
         `${i1}// A failure from here on undoes what was registered, since the caller never gets the handle.`,
         `${i1}try {`,
         `${i2}for (const end of ends) {`,
         `${i3}portEnds.set(end.key, { contents: end.contents, close });`,
         `${i2}}`,
         `${i2}listenForPortDisconnects(channel);`,
         `${i2}for (const end of watched) {`,
         `${i3}unwatchClosed.push(watchEvent(end.win, 'closed', close));`,
         `${i3}watches.set(end.win, watchPageLoad(end.contents, pair));`,
         `${i2}}`,
         `${i2}pair();`,
         `${i1}} catch (error) {`,
         `${i2}close();`,
         `${i2}throw error;`,
         `${i1}}`,
         `${i1}return { close };`,
         "}",
         "",
      ].join("\n");
   }
   /** `ipc.<name>.connect(winA, winB)`, which pairs the windows and returns a handle to close the connection. */
   private buildPortChannel(spec: t.ChannelSpec): ChannelEntry {
      const i1 = this.indents[1];
      const connector = [
         `\n${i1}connect: (winA: BrowserWindow, winB: BrowserWindow) =>`,
         ` connectPorts(${this.wireName(spec.name)}, winA, winB),`,
      ].join("");
      return { name: spec.name, members: [connector] };
   }
   /**
    * `connectMainPort`, which `ipc.<name>.connect` of a `mainPort` channel calls, and
    * `configurePorts`, which sets the overflow callback that the send queues use by default. The main process
    * keeps one end of a `MessageChannelMain` and transfers the other to the page, with the key of
    * the connection. It pairs once the page has loaded (see `watchPageLoad`), since a port that is
    * posted earlier arrives before the preload script listens for it, and again whenever a page loads, so a page that
    * reloads gets a fresh port, and the old port is dropped without ending the connection. The
    * connection has the shape of the one that a page gets from `onConnection`:
    * - `send` queues the messages until a port is there, and flushes them in order. The queue holds
    *   at most `maxQueue` messages. A message that does not fit goes to the overflow callback of
    *   the connection, or else to the global one of `configurePorts`, with a copy of the queue, the
    *   message and the counts. The callback returns the messages to keep, the oldest are dropped if
    *   there are too many, and it is the oldest message that is dropped without a callback, and
    *   when the callback fails. The first drop is logged with `console.warn`, then every 100th;
    * - `on`, `onReady` and `onClose` keep any number of subscribers with their own disposers, and a
    *   subscriber which throws is reported to `console.error` and does not stop the others;
    * - `onReady` runs at once if a port is there, and again for every new port;
    * - `onClose` runs when the port closes, such as when the page goes away, and when `close` ends
    *   the connection. `close` is final: the page is told through `<channel>:close`, the port is
    *   closed and a reload pairs no more. The connection also ends when the contents are destroyed,
    *   and when the page asks for it.
    *
    * With a serializer, a message is posted as a list of one value, which is the list of the arguments
    * as the serializer made it, and a message that arrives is deserialized the same way. A `send`
    * that cannot be serialized throws an `IpcSerializationError` when a port is there. A message that
    * waits in the queue is serialized when the queue is flushed, and one that cannot be is logged
    * with `console.error` and dropped, like one that cannot be posted. A message that cannot be
    * deserialized is logged and dropped.
    */
   private buildMainPortHelpers(): string {
      const [i1, i2, i3, i4, i5] = this.indents;
      const serialized = this.usesSerializer();
      const wire = (args: string) => (serialized ? `[encodeValue(name, ${args})]` : args);
      return [
         "",
         "export interface PortOverflowInfo {",
         `${i1}channel: string;`,
         `${i1}max: number;`,
         `${i1}dropped: number;`,
         `${i1}warnings: number;`,
         "}",
         "",
         "export interface PortsConfig {",
         `${i1}onOverflow?: (queue: unknown[][], message: unknown[], info: PortOverflowInfo) => unknown[][];`,
         "}",
         "",
         "let portsConfig: PortsConfig = {};",
         "",
         "export function configurePorts(config: PortsConfig): void {",
         `${i1}portsConfig = { onOverflow: config.onOverflow };`,
         "}",
         "",
         "interface MainPortConnection {",
         `${i1}send: (...args: any[]) => void;`,
         `${i1}on: (callback: Function) => () => void;`,
         `${i1}onReady: (callback: () => void) => () => void;`,
         `${i1}onClose: (callback: () => void) => () => void;`,
         `${i1}onOverflow: (callback: Function | undefined) => () => void;`,
         `${i1}close: () => void;`,
         "}",
         "",
         "type MainPortListener = { callback: Function };",
         "",
         "interface MainPortQueue {",
         `${i1}items: unknown[][];`,
         `${i1}dropped: number;`,
         `${i1}warnings: number;`,
         "}",
         "",
         "function enqueueMainPort(",
         `${i1}queue: MainPortQueue,`,
         `${i1}args: unknown[],`,
         `${i1}channel: string,`,
         `${i1}max: number,`,
         `${i1}overflow: Function | undefined,`,
         "): void {",
         `${i1}if (queue.items.length < max) {`,
         `${i2}queue.items.push(args);`,
         `${i2}return;`,
         `${i1}}`,
         `${i1}const before = queue.dropped;`,
         `${i1}let kept: unknown[][] | undefined;`,
         `${i1}if (overflow) {`,
         `${i2}try {`,
         `${i3}const result = overflow([...queue.items], args, { channel, max, dropped: before, warnings: queue.warnings });`,
         `${i3}if (!Array.isArray(result) || !result.every((item) => Array.isArray(item))) {`,
         `${i4}throw new TypeError(\`The overflow callback of the channel '\${channel}' must return an array of messages\`);`,
         `${i3}}`,
         `${i3}kept = result;`,
         `${i2}} catch (error) {`,
         `${i3}console.error(error);`,
         `${i2}}`,
         `${i1}}`,
         `${i1}if (!kept) {`,
         `${i2}kept = max > 0 ? [...queue.items.slice(1), args] : [];`,
         `${i1}}`,
         `${i1}// The oldest messages that do not fit, and the waiting ones and the new one that were left out.`,
         `${i1}const truncated = Math.max(0, kept.length - max);`,
         `${i1}queue.dropped += truncated + Math.max(0, queue.items.length + 1 - kept.length);`,
         `${i1}queue.items = kept.slice(truncated);`,
         `${i1}if (before === 0 || Math.floor(queue.dropped / 100) > Math.floor(before / 100)) {`,
         `${i2}queue.warnings += 1;`,
         `${i2}console.warn(\`The send queue of the port channel '\${channel}' is full (maxQueue \${max}), so messages are being dropped. Dropped so far: \${queue.dropped}. Warnings so far: \${queue.warnings}.\`);`,
         `${i1}}`,
         "}",
         "",
         "function notifyMainPortListeners(listeners: Iterable<MainPortListener>, args: unknown[]): void {",
         `${i1}for (const listener of [...listeners]) {`,
         `${i2}try {`,
         `${i3}listener.callback(...args);`,
         `${i2}} catch (error) {`,
         `${i3}console.error(error);`,
         `${i2}}`,
         `${i1}}`,
         "}",
         "",
         "function addMainPortListener(listeners: Set<MainPortListener>, callback: Function) {",
         `${i1}const listener = { callback };`,
         `${i1}listeners.add(listener);`,
         `${i1}return { listener, dispose: () => void listeners.delete(listener) };`,
         "}",
         "",
         "function connectMainPort(",
         `${i1}channel: string,`,
         `${i1}name: string,`,
         `${i1}max: number,`,
         `${i1}target: BrowserWindow | WebContents | WebContentsView,`,
         "): MainPortConnection {",
         `${i1}const contents = 'webContents' in target ? target.webContents : target;`,
         `${i1}// Contents that are destroyed already would never emit 'destroyed', which leaves the entry behind.`,
         `${i1}if (contents.isDestroyed()) {`,
         `${i2}throw new TypeError('Object has been destroyed');`,
         `${i1}}`,
         `${i1}const key = \`\${++lastPortConnectionId}:main\`;`,
         `${i1}const subscribers = new Set<MainPortListener>();`,
         `${i1}const readyListeners = new Set<MainPortListener>();`,
         `${i1}const closeListeners = new Set<MainPortListener>();`,
         `${i1}const pending: MainPortQueue = { items: [], dropped: 0, warnings: 0 };`,
         `${i1}let ownOverflow: Function | undefined;`,
         `${i1}let port: MessagePortMain | null = null;`,
         `${i1}let closed = false;`,
         `${i1}const watch = watchPageLoad(contents, () => pair());`,
         `${i1}let unwatchDestroyed = (): void => undefined;`,
         `${i1}const isReady = () => !contents.isDestroyed() && watch.isLoaded();`,
         `${i1}// Drops the port without ending the connection, which is what a new port replaces.`,
         `${i1}const release = () => {`,
         `${i2}const current = port;`,
         `${i2}port = null;`,
         `${i2}current?.close();`,
         `${i2}return current;`,
         `${i1}};`,
         `${i1}const attach = (next: MessagePortMain) => {`,
         `${i2}release();`,
         `${i2}port = next;`,
         `${i2}next.on('message', (event: { data: unknown }) => {`,
         ...(serialized
            ? [
                 `${i3}if (port === next && Array.isArray(event.data)) {`,
                 `${i4}const args = readSentArguments(name, event.data);`,
                 `${i4}if (args) {`,
                 `${i5}notifyMainPortListeners(subscribers, args);`,
                 `${i4}}`,
                 `${i3}}`,
              ]
            : [
                 `${i3}if (port === next && Array.isArray(event.data)) {`,
                 `${i4}notifyMainPortListeners(subscribers, event.data);`,
                 `${i3}}`,
              ]),
         `${i2}});`,
         `${i2}next.on('close', () => {`,
         `${i3}if (port === next) {`,
         `${i4}port = null;`,
         `${i4}notifyMainPortListeners(closeListeners, []);`,
         `${i3}}`,
         `${i2}});`,
         `${i2}next.start();`,
         `${i2}for (const args of pending.items.splice(0)) {`,
         `${i3}try {`,
         `${i4}next.postMessage(${wire("args")});`,
         `${i3}} catch (error) {`,
         `${i4}console.error(error);`,
         `${i3}}`,
         `${i2}}`,
         `${i2}notifyMainPortListeners(readyListeners, []);`,
         `${i1}};`,
         `${i1}const pair = () => {`,
         `${i2}if (closed || !isReady()) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}const { port1, port2 } = new MessageChannelMain();`,
         `${i2}attach(port1);`,
         `${i2}contents.postMessage(channel, key, [port2]);`,
         `${i1}};`,
         `${i1}const close = () => {`,
         `${i2}if (closed) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}closed = true;`,
         `${i2}pending.items.length = 0;`,
         `${i2}portEnds.delete(key);`,
         `${i2}watch.dispose();`,
         `${i2}unwatchDestroyed();`,
         `${i2}// Destroyed contents cannot be reached.`,
         `${i2}if (!contents.isDestroyed()) {`,
         `${i3}contents.send(\`\${channel}:close\`, key);`,
         `${i2}}`,
         `${i2}if (release()) {`,
         `${i3}notifyMainPortListeners(closeListeners, []);`,
         `${i2}}`,
         `${i1}};`,
         `${i1}// A failure from here on undoes what was registered, since the caller never gets the connection.`,
         `${i1}try {`,
         `${i2}portEnds.set(key, { contents, close });`,
         `${i2}listenForPortDisconnects(channel);`,
         `${i2}unwatchDestroyed = watchEvent(contents, 'destroyed', close);`,
         `${i2}pair();`,
         `${i1}} catch (error) {`,
         `${i2}close();`,
         `${i2}throw error;`,
         `${i1}}`,
         `${i1}return {`,
         `${i2}send: (...args: any[]) => {`,
         `${i3}if (closed) {`,
         `${i4}return;`,
         `${i3}}`,
         `${i3}if (port) {`,
         `${i4}port.postMessage(${wire("args")});`,
         `${i3}} else {`,
         `${i4}enqueueMainPort(pending, args, name, max, ownOverflow ?? portsConfig.onOverflow);`,
         `${i3}}`,
         `${i2}},`,
         `${i2}on: (callback: Function) => addMainPortListener(subscribers, callback).dispose,`,
         `${i2}onReady: (callback: () => void) => {`,
         `${i3}const { listener, dispose } = addMainPortListener(readyListeners, callback);`,
         `${i3}if (port) {`,
         `${i4}notifyMainPortListeners([listener], []);`,
         `${i3}}`,
         `${i3}return dispose;`,
         `${i2}},`,
         `${i2}onClose: (callback: () => void) => addMainPortListener(closeListeners, callback).dispose,`,
         `${i2}onOverflow: (callback: Function | undefined) => {`,
         `${i3}ownOverflow = callback;`,
         `${i3}return () => {`,
         `${i4}if (ownOverflow === callback) {`,
         `${i5}ownOverflow = undefined;`,
         `${i4}}`,
         `${i3}};`,
         `${i2}},`,
         `${i2}close,`,
         `${i1}};`,
         "}",
         "",
      ].join("\n");
   }
   /**
    * `ipc.<name>.connect(target)` of a `mainPort` channel, which pairs the contents of the window,
    * the view or the contents and returns the connection. The messages are typed with the signature
    * in both directions: `send` takes its parameters, and the callback of `on` is the signature.
    */
   private buildMainPortChannel(spec: t.ChannelSpec): ChannelEntry {
      const i1 = this.indents[1];
      const typeParams = this.getTypeParams(spec.signature);
      const send = `${typeParams}(${this.getOriginalParams(spec, false)}) => void`;
      const message = `Parameters<${spec.signature.definition}>`;
      const overflow = `(queue: ${message}[], message: ${message}, info: PortOverflowInfo) => ${message}[]`;
      const connection = [
         `{ send: ${send};`,
         ` on: (callback: ${spec.signature.definition}) => () => void;`,
         " onReady: (callback: () => void) => () => void;",
         " onClose: (callback: () => void) => () => void;",
         ` onOverflow: (callback: (${overflow}) | undefined) => () => void;`,
         " close: () => void }",
      ].join("");
      const connector = [
         `\n${i1}connect: (target: BrowserWindow | WebContents | WebContentsView): ${connection} =>`,
         ` connectMainPort(${this.wireName(spec.name)}, '${spec.name}', ${this.getMaxQueue(spec)}, target),`,
      ].join("");
      return { name: spec.name, members: [connector] };
   }
   /**
    * The helpers of the channels between the main process and utility processes: the protocol
    * that `utility.ts` shares (see `buildUtilityPeer`), and one peer per `UtilityProcess`. The peer
    * listens for the messages of the child, and is closed when the child exits, which rejects the
    * pending calls with `IPC_UTILITY_EXITED`.
    *
    * The exit of a child cannot be read afterwards (`pid` is `undefined` before the spawn and after
    * the exit, and Electron drops what is posted to a child that is gone), so a child has to be
    * known from its fork: `forkUtility(...)` forks and attaches it at once, and `attachUtility(child)`
    * does the same for a child that was forked elsewhere, right after `utilityProcess.fork`. A
    * channel that is given a child which was never attached fails with
    * `IPC_UTILITY_NOT_ATTACHED`, since it would otherwise wait for a child that is gone (T86).
    * A child which calls the main process also needs its peer from the start.
    */
   private buildUtilityHelpers(): string {
      const [i1] = this.indents;
      return [
         // The brokered channels are not serialized in main, which keeps the serializer helpers out.
         buildUtilityPeer(this.indents, this.hasSerializedChannels()),
         "const utilityPeers = new WeakMap<UtilityProcess, UtilityPeer>();",
         "",
         "function getUtilityPeer(child: UtilityProcess, channel: string): UtilityPeer {",
         `${i1}const known = utilityPeers.get(child);`,
         `${i1}if (!known) {`,
         `${i1}${i1}throw new IpcUtilityError(channel, \`The utility process of the channel '\${channel}' was not attached. Fork it with forkUtility(), or call attachUtility(child) right after utilityProcess.fork()\`, 'IPC_UTILITY_NOT_ATTACHED');`,
         `${i1}}`,
         `${i1}return known;`,
         "}",
         "",
         "/** Rejects, as a promise does, when the child is not attached. */",
         "function callUtilityChild(child: UtilityProcess, channel: string, args: unknown[], timeoutMs?: number): Promise<unknown> {",
         `${i1}try {`,
         `${i1}${i1}return callUtilityPeer(getUtilityPeer(child, channel), channel, args, timeoutMs);`,
         `${i1}} catch (error) {`,
         `${i1}${i1}return Promise.reject(error);`,
         `${i1}}`,
         "}",
         "",
         "/**",
         " * Starts listening to a child that was forked elsewhere, so that its exit is seen and its calls are",
         " * answered. Call it right after `utilityProcess.fork`, before the child can exit. It does nothing for a",
         " * child that is attached already.",
         " */",
         "export function attachUtility(child: UtilityProcess): void {",
         `${i1}if (utilityPeers.has(child)) {`,
         `${i1}${i1}return;`,
         `${i1}}`,
         `${i1}const peer = createUtilityPeer((message) => child.postMessage(message));`,
         `${i1}utilityPeers.set(child, peer);`,
         `${i1}child.on('message', (message: unknown) => receiveUtilityMessage(peer, message));`,
         `${i1}child.once('exit', () => closeUtilityPeer(peer, 'The utility process exited'));`,
         "}",
         "",
         "/** `utilityProcess.fork`, which attaches the child at once, so that its exit is seen from the start. */",
         "export function forkUtility(...args: Parameters<typeof utilityProcess.fork>): UtilityProcess {",
         `${i1}const child = utilityProcess.fork(...args);`,
         `${i1}attachUtility(child);`,
         `${i1}return child;`,
         "}",
         "",
      ].join("\n");
   }
   /**
    * `invoke(child, ...args)` of a `callUtility` channel, `send(child, ...args)` of a
    * `notifyUtility` channel, `handle(child, callback)` of a `callMain` channel and
    * `on(child, callback)` and `once(child, callback)` of a `notifyMain` channel.
    */
   private buildUtilityChannel(spec: t.ChannelSpec): ChannelEntry {
      const [, i1, i2] = this.indents;
      // The names of the generated parameters must not shadow a parameter of the signature.
      const taken = this.collectIdentifiers([spec.signature.definition]);
      const childName = this.uniqueName("child", taken);
      const callbackName = this.uniqueName("callback", taken);
      const wire = this.wireName(spec.name);
      const peer = `getUtilityPeer(${childName}, ${wire})`;
      const childParam = `${childName}: UtilityProcess`;
      const typeParams = this.getTypeParams(spec.signature);
      const params = (...generated: string[]) =>
         [...generated, this.getOriginalParams(spec, false)].filter(Boolean).join(", ");
      const senderParams = this.getOriginalParams(spec, true);
      const rest = senderParams ? `[${senderParams}]` : "[]";
      const callback = `${callbackName}: ${spec.signature.definition}`;
      if (spec.direction === "MainToUtility") {
         if (spec.kind === "Broadcast") {
            return {
               name: spec.name,
               members: [
                  `\n${i1}send: ${typeParams}(${params(childParam)}): void =>`,
                  `\n${i2}sendUtilityPeer(${peer}, ${wire}, ${rest}),`,
               ],
            };
         }
         const returned = spec.signature.async
            ? spec.signature.returnType
            : `Promise<Awaited<${spec.signature.returnType}>>`;
         return {
            name: spec.name,
            members: [
               `\n${i1}invoke: ${typeParams}(${params(childParam)}): ${returned} =>`,
               `\n${i2}callUtilityChild(${childName}, ${wire}, ${rest}${this.getTimeoutArgument(spec)}) as ${returned},`,
            ],
         };
      }
      if (spec.kind === "Broadcast") {
         return {
            name: spec.name,
            members: [
               `\n${i1}on: (${childParam}, ${callback}) =>`,
               `\n${i2}addUtilityListener(${peer}, ${wire}, ${callbackName}, false),`,
               `\n${i1}once: (${childParam}, ${callback}) =>`,
               `\n${i2}addUtilityListener(${peer}, ${wire}, ${callbackName}, true),`,
            ],
         };
      }
      return {
         name: spec.name,
         members: [
            `\n${i1}handle: (${childParam}, ${callback}) =>`,
            `\n${i2}setUtilityHandler(${peer}, ${wire}, ${callbackName}),`,
         ],
      };
   }
   /**
    * `connectUtilityPort`, which `ipc.<name>.connect` of an `invokeUtility` or `streamUtility`
    * channel calls. The main process only pairs the page with the child, and sees none of the
    * traffic: it makes a `MessageChannelMain`, posts one port to the child as
    * `{ __ipc: 'port', channel, key }`, and the other to the page on the channel, with the same key.
    * It pairs once the page has loaded (see `watchPageLoad`), and again whenever a page loads, so a
    * page that reloads gets a fresh port. A failure of the first pairing is thrown to the caller, a
    * later one goes to `console.error`. The connection ends when `close` is called, when the child
    * exits and when the contents are destroyed, and the page is told through `<channel>:close`.
    * A channel has one connection per page: connecting again replaces the earlier one, so the two
    * cannot fight over the port of the page on a reload. The contents are resolved first, and a
    * setup step that fails undoes what was registered.
    */
   private buildBrokerHelpers(): string {
      const [i1, i2, i3] = this.indents;
      return [
         "",
         "let lastUtilityLinkId = 0;",
         "const utilityLinks = new Map<string, () => void>();",
         "",
         "function connectUtilityPort(",
         `${i1}channel: string,`,
         `${i1}child: UtilityProcess,`,
         `${i1}target: BrowserWindow | WebContents | WebContentsView,`,
         "): { close: () => void } {",
         `${i1}const contents = 'webContents' in target ? target.webContents : target;`,
         `${i1}// Contents that are destroyed already would never emit 'destroyed', which leaves the entry behind.`,
         `${i1}if (contents.isDestroyed()) {`,
         `${i2}throw new TypeError('Object has been destroyed');`,
         `${i1}}`,
         `${i1}// A child that exited would leave the page waiting for a port which never comes.`,
         `${i1}if (getUtilityPeer(child, channel).closed) {`,
         `${i2}throw new IpcUtilityError(channel, \`The utility process of the channel '\${channel}' is gone\`, 'IPC_UTILITY_EXITED');`,
         `${i1}}`,
         `${i1}const linkKey = \`\${channel}:\${contents.id}\`;`,
         `${i1}const key = \`\${++lastUtilityLinkId}:utility\`;`,
         `${i1}let closed = false;`,
         `${i1}const unwatch: (() => void)[] = [];`,
         `${i1}const pair = () => {`,
         `${i2}if (closed || contents.isDestroyed() || !watch.isLoaded()) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}const { port1, port2 } = new MessageChannelMain();`,
         `${i2}try {`,
         `${i3}child.postMessage({ __ipc: 'port', channel, key }, [port1]);`,
         `${i3}contents.postMessage(channel, key, [port2]);`,
         `${i2}} catch (error) {`,
         `${i3}port1.close();`,
         `${i3}port2.close();`,
         `${i3}throw error;`,
         `${i2}}`,
         `${i1}};`,
         `${i1}const watch = watchPageLoad(contents, () => {`,
         `${i2}try {`,
         `${i3}pair();`,
         `${i2}} catch (error) {`,
         `${i3}console.error(error);`,
         `${i2}}`,
         `${i1}});`,
         `${i1}const close = () => {`,
         `${i2}if (closed) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}closed = true;`,
         `${i2}watch.dispose();`,
         `${i2}for (const stop of unwatch.splice(0)) {`,
         `${i3}stop();`,
         `${i2}}`,
         `${i2}if (utilityLinks.get(linkKey) === close) {`,
         `${i3}utilityLinks.delete(linkKey);`,
         `${i2}}`,
         `${i2}// Destroyed contents cannot be reached.`,
         `${i2}if (!contents.isDestroyed()) {`,
         `${i3}contents.send(\`\${channel}:close\`, key);`,
         `${i2}}`,
         `${i1}};`,
         `${i1}utilityLinks.get(linkKey)?.();`,
         `${i1}// A failure from here on undoes what was registered, since the caller never gets the handle.`,
         `${i1}try {`,
         `${i2}utilityLinks.set(linkKey, close);`,
         `${i2}unwatch.push(watchEvent(contents, 'destroyed', close), watchEvent(child, 'exit', close));`,
         `${i2}pair();`,
         `${i1}} catch (error) {`,
         `${i2}close();`,
         `${i2}throw error;`,
         `${i1}}`,
         `${i1}return { close };`,
         "}",
         "",
      ].join("\n");
   }
   /**
    * `ipc.<name>.connect(child, target)` of an `invokeUtility` or `streamUtility` channel, which
    * brokers the port between the child and the window, the view or the contents, and returns the
    * handle to close the connection. The calls themselves are made by the page, and handled by the
    * child, so the signature is not used here. Adds the electron imports that the helper uses.
    */
   private buildBrokeredChannel(
      spec: t.ChannelSpec,
      values: Set<string>,
      types: Set<string>,
   ): ChannelEntry {
      const i1 = this.indents[1];
      values.add("MessageChannelMain");
      for (const type of BROKER_TYPES) {
         types.add(type);
      }
      const connector = [
         `\n${i1}connect: (child: UtilityProcess, target: BrowserWindow | WebContents | WebContentsView): { close: () => void } =>`,
         ` connectUtilityPort(${this.wireName(spec.name)}, child, target),`,
      ].join("");
      return { name: spec.name, members: [connector] };
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
