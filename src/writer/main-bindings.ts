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
import {
   buildErrorEnvelope,
   buildSerializerRuntime,
   buildUtilityPeer,
   UTILITY_RUNTIME_NAMES,
} from "./utility-runtime.js";

interface ChannelEntry {
   name: string;
   /** The members of the channel object, one per line, indented for the object body. */
   members: string[];
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

/** The names that a generated listener uses, which differ from the names of its signature. */
interface ListenerNames {
   event: string;
   callback: string;
   listener: string;
   remove: string;
   eventType: string;
   /** The channel name as a quoted literal. */
   channel: string;
   isBroadcast: boolean;
   /** The local name of the imported validator. */
   validator: string;
   received: string;
   args: string;
   call: string;
   spent: string;
   /** The name of the decoded arguments of a serialized channel. */
   decoded: string;
   /** Whether the arguments arrive through the serializer. */
   serialized: boolean;
}

export class MainBindingsWriter extends BaseWriter {
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
         // The channels to a utility process.
         ...(this.hasUtilityChannels()
            ? [
                 ...UTILITY_RUNTIME_NAMES,
                 "UtilityProcess",
                 "WeakMap",
                 "utilityPeers",
                 "getUtilityPeer",
                 "attachUtility",
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
               electronTypeImportsSet.add(this.getEventType(spec));
               eventTypes.add(this.getEventType(spec));
               usesEnvelope ||= this.usesEnvelope(spec);
               usesStreams ||= spec.kind === "Stream";
               const validator = this.importValidator(
                  parsedFileSpecs,
                  spec,
                  importDeclarationsArray,
               );
               usesValidation ||= validator !== null;
               channels.push(this.buildRendererToMainChannel(spec, validator));
            } else if (spec.direction === "MainToRenderer") {
               usesSenders = true;
               electronImportsSet.add("webContents as electronWebContents");
               for (const type of this.getSenderTypes(spec)) {
                  electronTypeImportsSet.add(type);
               }
               channels.push(this.buildMainToRendererChannel(spec));
            } else {
               const validator = this.importValidator(
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
            const specCustomTypes = new Set(this.getImportedTypes(spec));
            customTypes = customTypes.union(specCustomTypes);
         }
         this.importCustomTypes(parsedFileSpecs, customTypes, importDeclarationsArray);
      }
      usesEnvelope ||= offPage.envelope;
      if (this.hasSerializedChannels()) {
         importDeclarationsArray.push(this.buildSerializerImport());
      }
      this.addWorkerImports(offPage.workers, electronTypeImportsSet);
      this.addStreamImports(usesStreams, electronImportsSet, electronTypeImportsSet);
      this.addTargetImports(usesIpcMain, electronTypeImportsSet);
      const scopes = this.getScopes();
      this.addScopeImports(scopes.length > 0, electronTypeImportsSet);
      const usesAsks = this.hasChannels("Unicast");
      const usesEmits = this.hasChannels("Broadcast");
      const usesRendererPorts = this.hasPorts("RendererToRenderer");
      const usesMainPorts = this.hasPorts("MainToRenderer");
      const usesPorts = usesRendererPorts || usesMainPorts;
      const out = this.buildImports(
         [...this.getIpcMainImport(usesIpcMain || usesAsks || usesPorts), ...electronImportsSet],
         [...electronTypeImportsSet],
         importDeclarationsArray,
      );
      const [i0] = this.indents;
      const bindingsExpression = this.buildSupport(
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
            usesScopedGuards: this.hasScopedGuards(),
         },
         [...eventTypes].sort(utils.compareStrings),
      );
      bindingsExpression.push("\nexport const ipc = {");
      for (const channel of this.sortChannels(channels)) {
         bindingsExpression.push(`\n${i0}${channel.name}: {`, ...channel.members, `\n${i0}},`);
      }
      bindingsExpression.push("\n}\n");

      out.push(bindingsExpression.join(""));
      return out.join("\n");
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
         types.add("UtilityProcess");
         return [this.buildUtilityChannel(spec)];
      } else if (this.isBrokeredSpec(spec)) {
         uses.brokers = true;
         return [this.buildBrokeredChannel(spec, values, types)];
      }
      // The specs left are the ones between the main process and a service worker.
      uses.workers.push(spec);
      uses.envelope ||= this.usesWorkerEnvelope(spec);
      return [this.buildWorkerChannel(spec)];
   }
   /** The import of `ipcMain`, if the generated code registers a listener or a handler. */
   private getIpcMainImport(used: boolean): string[] {
      return used ? ["ipcMain as electronIpcMain"] : [];
   }
   /** Adds the import lines for the custom types that the channels of the file use. */
   private importCustomTypes(
      pfs: t.ParsedFileSpecs,
      customTypes: Set<string>,
      declarations: string[],
   ): void {
      for (const customType of customTypes) {
         const declaration = this.importsGenerator.getDeclaration(pfs, customType);
         if (declaration) {
            declarations.push(declaration);
         }
      }
   }
   /** The import lines: the values and the types of `electron`, then the ones from the schema files. */
   private buildImports(values: string[], types: string[], declarations: string[]): string[] {
      return [
         ...(values.length > 0 ? [`import { ${values.join(", ")} } from "electron";`] : []),
         ...(types.length > 0 ? [`import type { ${types.join(", ")} } from "electron";`] : []),
         ...declarations.sort(utils.compareStrings),
      ];
   }
   /** Adds the electron imports that the helpers of the `stream` channels use. */
   private addStreamImports(used: boolean, values: Set<string>, types: Set<string>): void {
      if (used) {
         values.add("MessageChannelMain");
         for (const type of ["MessagePortMain", "WebContents", "WebFrameMain"]) {
            types.add(type);
         }
      }
   }
   /** Adds the electron types that `resolveIpcTarget` uses: the `IpcMain` of the app or of some contents. */
   private addTargetImports(used: boolean, types: Set<string>): void {
      if (used) {
         types.add("IpcMain");
         types.add("WebContents");
      }
   }
   /** Adds the electron types that `registerScope` uses. */
   private addScopeImports(used: boolean, types: Set<string>): void {
      if (used) {
         for (const type of ["BrowserWindow", "WebContents", "WebContentsView"]) {
            types.add(type);
         }
      }
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
    * The custom types of the signature that the generated code needs. The main process only pairs
    * a page with a child, and sees none of the traffic, so it needs none for those channels.
    */
   private getImportedTypes(spec: t.ChannelSpec): string[] {
      return this.isBrokeredSpec(spec) ? [] : spec.signature.customTypes;
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
   /** The electron types that the channels which send to a renderer use. */
   private getSenderTypes(spec: t.ChannelSpec): string[] {
      const types = ["BrowserWindow", "WebContents", "WebContentsView", "WebFrameMain"];
      // The listener of the replies of an `ask` channel takes the event of `ipcMain.on`.
      return spec.kind === "Unicast" ? [...types, "IpcMainEvent"] : types;
   }
   /** The helpers that the channels of the file use, in the order that they are declared. */
   private buildSupport(
      uses: {
         usesIpcMain: boolean;
         usesValidation: boolean;
         usesEnvelope: boolean;
         usesSenders: boolean;
         usesEmits: boolean;
         usesAsks: boolean;
         usesPorts: boolean;
         usesRendererPorts: boolean;
         usesMainPorts: boolean;
         usesStreams: boolean;
         usesSerializer: boolean;
         usesUtility: boolean;
         usesBrokers: boolean;
         workerSpecs: t.ChannelSpec[];
         workerValidators: Map<t.ChannelSpec, string>;
         scopes: string[];
         usesScopedGuards: boolean;
      },
      eventTypes: string[],
   ): string[] {
      const support: string[] = [];
      if (uses.scopes.length > 0) {
         support.push(this.buildScopeRegistry(uses.scopes));
      }
      if (uses.usesIpcMain) {
         support.push(
            this.buildSenderValidation(eventTypes, uses.usesValidation, uses.usesScopedGuards),
            this.buildTargetResolver(),
         );
      }
      if (uses.usesValidation || uses.workerValidators.size > 0) {
         support.push(
            this.buildArgumentValidation(
               uses.usesValidation ? eventTypes : [],
               this.getValidatedWorkerEvents(uses.workerValidators),
            ),
         );
      }
      if (uses.usesEnvelope) {
         support.push(this.buildErrorEnvelope());
      }
      if (uses.usesSerializer) {
         support.push(this.buildSerializerHelpers());
      }
      if (uses.usesSenders) {
         support.push(this.buildSenderHelpers(uses.usesEmits));
      }
      if (uses.usesAsks) {
         support.push(this.buildAskHelpers());
      }
      if (uses.workerSpecs.length > 0) {
         support.push(
            this.buildWorkerHelpers(uses.workerSpecs, uses.usesAsks, uses.workerValidators),
         );
      }
      if (uses.usesStreams) {
         support.push(this.buildStreamHelpers());
      }
      if (uses.usesUtility) {
         support.push(this.buildUtilityHelpers());
      }
      if (uses.usesPorts) {
         support.push(this.buildPortRegistry());
      }
      if (uses.usesPorts || uses.usesBrokers) {
         support.push(this.buildPageLoadWatch());
      }
      if (uses.usesBrokers) {
         support.push(this.buildBrokerHelpers());
      }
      if (uses.usesRendererPorts) {
         support.push(this.buildPortHelpers());
      }
      if (uses.usesMainPorts) {
         support.push(this.buildMainPortHelpers());
      }
      return support;
   }
   /** The scopes that the channels list, in code unit order. */
   private getScopes(): string[] {
      return collectScopes(this.pfsArray);
   }
   /**
    * Whether a call from a renderer is checked against a scope: the channels that a page calls in
    * the main process (`invoke`, `send` and `stream`) with `scopes`.
    */
   private hasScopedGuards(): boolean {
      return this.pfsArray.some((pfs) =>
         pfs.specs.channelSpecArray.some(
            (spec) => spec.direction === "RendererToMain" && spec.scopes !== undefined,
         ),
      );
   }
   /**
    * The registry of the scopes of the windows: `IpcScope`, the names that the schema declares, and
    * `registerScope(target, scope)`, which puts the contents of a window, a view or contents into a
    * scope. A channel with `scopes` is open only to the contents that are registered in one of its
    * scopes, and contents that are in no scope can use only the channels without `scopes`. The
    * registry holds the ID of the contents, so it keeps no reference to them. An entry is removed
    * by its disposer and when the contents are destroyed, and registering the contents again
    * replaces the entry: the disposer of the replaced one does nothing. A scope that the schema
    * does not declare is a mistake which would otherwise lock the window out without a word, so
    * it throws.
    */
   private buildScopeRegistry(scopes: string[]): string {
      const [i1, i2, i3] = this.indents;
      const names = scopes.map((scope) => `'${scope}'`);
      return [
         "",
         `export type IpcScope = ${names.join(" | ")};`,
         "",
         `const ipcScopeNames: readonly string[] = [${names.join(", ")}];`,
         "",
         "interface ScopeEntry {",
         `${i1}scope: IpcScope;`,
         `${i1}remove: () => void;`,
         "}",
         "",
         "const scopeRegistry: { [id: string]: ScopeEntry | undefined } = { __proto__: null } as any;",
         "",
         "export function registerScope(",
         `${i1}target: BrowserWindow | WebContents | WebContentsView,`,
         `${i1}scope: IpcScope,`,
         "): () => void {",
         `${i1}if (!ipcScopeNames.includes(scope)) {`,
         `${i2}throw new TypeError(\`The scope '\${scope}' is not declared in the schema. Use one of: \${ipcScopeNames.join(', ')}\`);`,
         `${i1}}`,
         `${i1}const contents = 'webContents' in target ? target.webContents : target;`,
         `${i1}if (contents.isDestroyed()) {`,
         `${i2}throw new TypeError('Object has been destroyed');`,
         `${i1}}`,
         `${i1}const id = contents.id;`,
         `${i1}scopeRegistry[id]?.remove();`,
         `${i1}const remove = () => {`,
         `${i2}if (scopeRegistry[id] === entry) {`,
         `${i3}delete scopeRegistry[id];`,
         `${i2}}`,
         `${i2}if (!contents.isDestroyed()) {`,
         `${i3}contents.removeListener('destroyed', remove);`,
         `${i2}}`,
         `${i1}};`,
         `${i1}const entry: ScopeEntry = { scope, remove };`,
         `${i1}scopeRegistry[id] = entry;`,
         `${i1}contents.once('destroyed', remove);`,
         `${i1}return remove;`,
         "}",
         "",
      ].join("\n");
   }
   /**
    * Where a listener or handler is registered: `resolveIpcTarget` returns the global `ipcMain`, or
    * with `options.webContents` the `ipc` of those contents, which Electron dispatches to before
    * `ipcMain` and which only gets the messages of that page. It also gives the registry of the
    * handlers that the target has now, which a disposer compares against (it uses no global, which
    * a schema type could shadow, and has no prototype), and `watch`, which disposes the
    * registration when the contents are destroyed. The registry of the contents and the single
    * `destroyed` listener are made once per contents, so any number of channels does not hit the
    * limit of listeners, and both are dropped when the contents are destroyed. Contents which are
    * already destroyed throw, since `ipc` would never receive anything.
    */
   private buildTargetResolver(): string {
      const [i1, i2, i3, i4] = this.indents;
      return [
         "",
         "export interface IpcListenOptions {",
         `${i1}/**`,
         `${i1} * Registers on the \`ipc\` of these contents instead of the global \`ipcMain\`: only the`,
         `${i1} * messages of this page arrive, an \`invoke\` handler wins over the global one, and the`,
         `${i1} * registration is removed when the contents are destroyed.`,
         `${i1} */`,
         `${i1}webContents?: WebContents;`,
         "}",
         "",
         "interface IpcTarget {",
         `${i1}ipc: IpcMain;`,
         `${i1}handlers: { [channel: string]: unknown };`,
         `${i1}watch: (remove: () => void) => () => void;`,
         "}",
         "",
         "interface IpcContentsRecord {",
         `${i1}handlers: { [channel: string]: unknown };`,
         `${i1}removers: (() => void)[];`,
         "}",
         "",
         "const registeredHandlers: { [channel: string]: unknown } = { __proto__: null };",
         "",
         "const contentsIpcRegistry: { [id: string]: unknown } = { __proto__: null };",
         "",
         "function resolveIpcTarget(options?: IpcListenOptions): IpcTarget {",
         `${i1}const contents = options?.webContents;`,
         `${i1}if (!contents) {`,
         `${i2}return { ipc: electronIpcMain, handlers: registeredHandlers, watch: () => () => {} };`,
         `${i1}}`,
         `${i1}if (contents.isDestroyed()) {`,
         `${i2}throw new TypeError('Object has been destroyed');`,
         `${i1}}`,
         `${i1}const id = contents.id;`,
         `${i1}let record = contentsIpcRegistry[id] as IpcContentsRecord | undefined;`,
         `${i1}if (!record) {`,
         `${i2}const created: IpcContentsRecord = { handlers: { __proto__: null }, removers: [] };`,
         `${i2}record = created;`,
         `${i2}contentsIpcRegistry[id] = created;`,
         `${i2}contents.once('destroyed', () => {`,
         `${i3}delete contentsIpcRegistry[id];`,
         `${i3}for (const remove of created.removers.slice()) {`,
         `${i4}remove();`,
         `${i3}}`,
         `${i2}});`,
         `${i1}}`,
         `${i1}const { handlers, removers } = record;`,
         `${i1}return {`,
         `${i2}ipc: contents.ipc,`,
         `${i2}handlers,`,
         `${i2}watch: (remove) => {`,
         `${i3}removers.push(remove);`,
         `${i3}return () => {`,
         `${i4}for (let at = 0; at < removers.length; at++) {`,
         `${i4}${i1}if (removers[at] === remove) {`,
         `${i4}${i2}removers.splice(at, 1);`,
         `${i4}${i2}return;`,
         `${i4}${i1}}`,
         `${i4}}`,
         `${i3}};`,
         `${i2}},`,
         `${i1}};`,
         "}",
         "",
      ].join("\n");
   }
   /**
    * Imports the validator of the channel, if it has one, and returns its local name. The import
    * line goes to `declarations` once, however many channels use the same validator.
    */
   private importValidator(
      pfs: t.ParsedFileSpecs,
      spec: t.ChannelSpec,
      declarations: string[],
   ): string | null {
      if (!spec.validate) {
         return null;
      }
      const imported = this.importsGenerator.getValueImport(pfs, spec.validate);
      if (imported.declaration) {
         declarations.push(imported.declaration);
      }
      return imported.local;
   }
   /**
    * Whether the results and errors of the handler of the channel are sent as an envelope. A
    * stream always does, since the start of a stream has no error of Electron's to leave it to.
    */
   private usesEnvelope(spec: t.ChannelSpec): boolean {
      return spec.kind === "Stream" || (spec.kind === "Unicast" && !this.config.rawErrors);
   }
   /**
    * The envelope of `invoke` channels: `settleInvoke` runs the handler and answers with
    * `{ ok: true, value }`, or with `{ ok: false, error }` when anything fails, including the
    * rejection of the sender and the validation of the arguments. `toIpcError` reduces what was
    * thrown to `{ name, message, code?, data? }`. Electron reports a rejected handler to the
    * renderer as the text `Error invoking remote method`, so these fields would be lost, and the
    * stack never leaves the main process. `data` is dropped when it cannot be cloned, since it
    * would otherwise fail the whole reply.
    */
   private buildErrorEnvelope(): string {
      return buildErrorEnvelope(this.indents);
   }
   /**
    * Electron passes an `IpcMainInvokeEvent` to `handle` listeners and an `IpcMainEvent`
    * to `on` listeners.
    */
   private getEventType(spec: t.ChannelSpec): string {
      return spec.kind === "Broadcast" ? "IpcMainEvent" : "IpcMainInvokeEvent";
   }
   /**
    * The serializer of the config, for the channels between the main process and a page and for
    * the ones between the main process and a utility process (see `buildSerializerRuntime`).
    * `IpcSerializationError` reaches the caller of a `send`, `emit` or `ask`, and the page as the
    * `{ name, message, code }` of the usual error envelope. Deserializing is done only after the
    * sender is checked, so that a rejected sender reaches no code of the serializer.
    */
   private buildSerializerHelpers(): string {
      return buildSerializerRuntime(this.indents);
   }
   /**
    * The sender validation of the main process: `configureIpc`, which sets the global validator
    * and the rejection hook, `IpcForbiddenError`, and `isSenderAllowed`, which every listener
    * and handler of a renderer-to-main channel calls first.
    *
    * Electron sets `senderFrame` to `null` when the frame is gone, so a missing frame is always
    * rejected, and the frame is read before any other work. The origin of the frame is compared
    * for equality with the allowed origins, never as a prefix, which `example.com.attacker.com`
    * would pass. A validator which throws counts as a rejection. Nothing is checked, as before,
    * until a validator or an `allowedOrigins` list applies to the channel.
    */
   private buildSenderValidation(
      eventTypes: string[],
      usesValidation: boolean,
      usesScopes: boolean,
   ): string {
      const [i1, i2, i3] = this.indents;
      const event = eventTypes.join(" | ");
      // With validators, the hook also learns why the call was rejected.
      const reason = usesValidation ? ", error: IpcForbiddenError | IpcValidationError" : "";
      const reasonArg = usesValidation ? ", new IpcForbiddenError(channel)" : "";
      return [
         "",
         "export class IpcForbiddenError extends Error {",
         `${i1}readonly code = 'IPC_FORBIDDEN';`,
         `${i1}readonly channel: string;`,
         `${i1}constructor(channel: string) {`,
         `${i2}super(\`The sender of the message is not allowed to use the channel '\${channel}'\`);`,
         `${i2}this.name = 'IpcForbiddenError';`,
         `${i2}this.channel = channel;`,
         `${i1}}`,
         "}",
         "",
         "export interface IpcConfig {",
         `${i1}validateSender?: (event: ${event}, channel: string) => boolean;`,
         `${i1}onRejected?: (event: ${event}, channel: string${reason}) => void;`,
         "}",
         "",
         "let ipcConfig: IpcConfig = {};",
         "",
         "export function configureIpc(config: IpcConfig): void {",
         `${i1}ipcConfig = { validateSender: config.validateSender, onRejected: config.onRejected };`,
         "}",
         "",
         usesScopes
            ? `function isSenderAllowed(event: ${event}, channel: string, allowedOrigins?: string[], scopes?: readonly IpcScope[]): boolean {`
            : `function isSenderAllowed(event: ${event}, channel: string, allowedOrigins?: string[]): boolean {`,
         `${i1}const validateSender = ipcConfig.validateSender;`,
         `${i1}if (!allowedOrigins && ${usesScopes ? "!scopes && " : ""}!validateSender) {`,
         `${i2}return true;`,
         `${i1}}`,
         `${i1}let allowed = false;`,
         `${i1}try {`,
         `${i2}const frame = event.senderFrame;`,
         `${i2}const origin = frame ? frame.origin : null;`,
         ...(usesScopes
            ? [`${i2}const entry = scopes ? scopeRegistry[event.sender.id] : undefined;`]
            : []),
         `${i2}allowed =`,
         `${i3}frame != null &&`,
         ...(usesScopes
            ? [`${i3}(!scopes || (entry !== undefined && scopes.includes(entry.scope))) &&`]
            : []),
         `${i3}(!allowedOrigins || (typeof origin === 'string' && allowedOrigins.includes(origin))) &&`,
         `${i3}(!validateSender || validateSender(event, channel) === true);`,
         `${i1}} catch {`,
         `${i2}allowed = false;`,
         `${i1}}`,
         `${i1}if (!allowed && ipcConfig.onRejected) {`,
         `${i2}try {`,
         `${i3}ipcConfig.onRejected(event, channel${reasonArg});`,
         `${i2}} catch {`,
         `${i3}// A failing hook must not decide whether the call is rejected.`,
         `${i2}}`,
         `${i1}}`,
         `${i1}return allowed;`,
         "}",
         "",
      ].join("\n");
   }
   /**
    * The argument validation of the main process, for channels with a `validate` option:
    * `IpcValidationError`, which carries the issues of the schema, and `validateArguments`,
    * which every validated listener calls after the sender check. It uses the Standard Schema
    * interface through a structural type, so the generated file has no dependency on a library.
    *
    * It validates the arguments exactly as they arrived, as one array, and passes the output of
    * the schema on, so what the handler gets is what the schema vouches for. A schema which
    * throws, rejects or answers with anything but a result, counts as a failure, so it never
    * lets an argument through. A synchronous schema keeps the call synchronous. An invalid call
    * is reported to `onRejected`, then an invoke throws the error and a send is dropped.
    *
    * `eventTypes` are the events of the channels of the pages, and `workerEvents` those of the
    * validated channels of service workers. A worker call has its own hook, so it passes `report`,
    * which `validateArguments` calls instead of the `onRejected` of `configureIpc`.
    */
   private buildArgumentValidation(eventTypes: string[], workerEvents: string[]): string {
      const [i1, i2, i3] = this.indents;
      const pageEvent = eventTypes.join(" | ");
      const workerEvent = workerEvents.join(" | ");
      const event = [...eventTypes, ...workerEvents].join(" | ");
      const hasPages = eventTypes.length > 0;
      const hasWorkers = workerEvents.length > 0;
      // The page hook is called when no `report` is given. A file with only worker calls has no such hook.
      const notify = hasWorkers
         ? hasPages
            ? [
                 `${i3}if (report) {`,
                 `${i3}${i1}report(event as ${workerEvent}, channel, error);`,
                 `${i3}} else {`,
                 `${i3}${i1}ipcConfig.onRejected?.(event as ${pageEvent}, channel, error);`,
                 `${i3}}`,
              ]
            : [`${i3}report(event as ${workerEvent}, channel, error);`]
         : [`${i3}ipcConfig.onRejected?.(event, channel, error);`];
      const report = hasWorkers
         ? [
              `${i1}report${hasPages ? "?" : ""}: (event: ${workerEvent}, channel: string, error: IpcValidationError) => void,`,
           ]
         : [];
      return [
         "",
         "export interface IpcValidationIssue {",
         `${i1}readonly message: string;`,
         `${i1}readonly path?: readonly (string | number | symbol | { readonly key: string | number | symbol })[];`,
         "}",
         "",
         "type IpcSchemaResult =",
         `${i1}| { readonly value: unknown; readonly issues?: undefined }`,
         `${i1}| { readonly issues: readonly IpcValidationIssue[] };`,
         "",
         "interface IpcArgumentsSchema {",
         `${i1}readonly '~standard': {`,
         `${i2}readonly validate: (value: unknown) => IpcSchemaResult | Promise<IpcSchemaResult>;`,
         `${i1}};`,
         "}",
         "",
         "export class IpcValidationError extends Error {",
         `${i1}readonly code = 'IPC_VALIDATION';`,
         `${i1}readonly channel: string;`,
         `${i1}readonly issues: readonly IpcValidationIssue[];`,
         `${i1}/** The issues with plain paths, which can be sent to the renderer. */`,
         `${i1}readonly data: { message: string; path?: (string | number)[] }[];`,
         `${i1}constructor(channel: string, issues: readonly IpcValidationIssue[]) {`,
         `${i2}super(\`The arguments of the channel '\${channel}' are invalid: \${issues.map((issue) => issue.message).join('; ')}\`);`,
         `${i2}this.name = 'IpcValidationError';`,
         `${i2}this.channel = channel;`,
         `${i2}this.issues = issues;`,
         `${i2}this.data = issues.map((issue) => ({`,
         `${i3}message: issue.message,`,
         `${i3}path: issue.path?.map((segment) => {`,
         `${i3}${i1}const key = typeof segment === 'object' ? segment.key : segment;`,
         `${i3}${i1}return typeof key === 'symbol' ? String(key) : key;`,
         `${i3}}),`,
         `${i2}}));`,
         `${i1}}`,
         "}",
         "",
         "function validateArguments<R>(",
         `${i1}event: ${event},`,
         `${i1}channel: string,`,
         `${i1}schema: IpcArgumentsSchema,`,
         `${i1}received: unknown[],`,
         `${i1}drop: boolean,`,
         `${i1}run: (args: unknown[]) => R,`,
         ...report,
         "): R | Promise<R | undefined> | undefined {",
         `${i1}const reject = (issues: readonly IpcValidationIssue[]): undefined => {`,
         `${i2}const error = new IpcValidationError(channel, issues);`,
         `${i2}try {`,
         ...notify,
         `${i2}} catch {`,
         `${i3}// A failing hook must not decide whether the call is rejected.`,
         `${i2}}`,
         `${i2}if (!drop) {`,
         `${i3}throw error;`,
         `${i2}}`,
         `${i2}return undefined;`,
         `${i1}};`,
         `${i1}const failed = (): undefined => reject([{ message: 'The arguments could not be validated' }]);`,
         `${i1}const accept = (result: IpcSchemaResult): R | undefined => {`,
         `${i2}if (!result || result.issues) {`,
         `${i3}return result ? reject(result.issues) : failed();`,
         `${i2}}`,
         `${i2}return Array.isArray(result.value)`,
         `${i3}? run(result.value)`,
         `${i3}: reject([{ message: 'The validated arguments are not an array' }]);`,
         `${i1}};`,
         `${i1}let outcome: IpcSchemaResult | Promise<IpcSchemaResult>;`,
         `${i1}try {`,
         `${i2}outcome = schema['~standard'].validate(received);`,
         `${i1}} catch {`,
         `${i2}return failed();`,
         `${i1}}`,
         `${i1}if (outcome && typeof (outcome as Promise<IpcSchemaResult>).then === 'function') {`,
         `${i2}return (outcome as Promise<IpcSchemaResult>).then(accept, failed);`,
         `${i1}}`,
         `${i1}return accept(outcome as IpcSchemaResult);`,
         "}",
         "",
      ].join("\n");
   }
   /** The events of the validated channels that a service worker calls, which the validation reports. */
   private getValidatedWorkerEvents(validators: Map<t.ChannelSpec, string>): string[] {
      const events = new Set<string>();
      for (const spec of validators.keys()) {
         events.add(this.getWorkerEventType(spec));
      }
      return [...events].sort(utils.compareStrings);
   }
   /**
    * `ipc.<name>.on(callback)` and `once` for `send` channels, and `handle` and `handleOnce` for
    * `invoke` channels. Each returns a function which removes that registration.
    * A channel has one handler, so registering a handler replaces the previous one instead of
    * throwing, which window re-creation and a hot restart of the main process need. The disposer
    * of a replaced handler does nothing, so that it cannot remove its replacement.
    * Every listener checks the sender first: a `send` from a rejected sender is dropped and a
    * rejected `invoke` throws an `IpcForbiddenError`.
    * `once` and `handleOnce` register a normal listener which removes itself after the first
    * allowed message, since `ipcMain.once` would be used up by a message from a rejected sender.
    */
   private buildRendererToMainChannel(spec: t.ChannelSpec, validator: string | null): ChannelEntry {
      const [, i1, i2, i3, i4] = this.indents;
      const eventType = this.getEventType(spec);
      // The names of the generated parameters must not shadow the ones of the signature, nor
      // the validator, which the listener refers to.
      const taken = this.collectIdentifiers([spec.signature.definition, validator ?? ""]);
      const eventName = this.uniqueName("event", taken);
      const callbackName = this.uniqueName("callback", taken);
      const listenerName = this.uniqueName("listener", taken);
      const wrapperParams = [`${eventName}: ${eventType}`, this.getOriginalParams(spec, false)];
      const forwarded = [eventName, this.getOriginalParams(spec, true)];
      const typeParams = this.getTypeParams(spec.signature);
      const modSigDef = this.injectEventTypehint(spec.signature, eventType, eventName);
      const channel = `'${spec.name}'`;
      const wire = this.wireName(spec.name);
      const isBroadcast = spec.kind === "Broadcast";
      // The origins come before the scopes, so a channel with scopes only passes `undefined` for them.
      const scopes = spec.scopes
         ? `, [${spec.scopes.map((scope) => `'${scope}'`).join(", ")}]`
         : "";
      const origins = spec.allowedOrigins
         ? `, [${spec.allowedOrigins.map((origin) => JSON.stringify(origin)).join(", ")}]`
         : scopes
           ? ", undefined"
           : "";
      // The generated names that the listener calls must not be shadowed by its parameters,
      // so the listener only calls the local functions below, whose names are unique.
      const serialized = this.isSerializedSpec(spec);
      const guardName = this.uniqueName("guard", taken);
      const removeName = this.uniqueName("remove", taken);
      const allowed = `isSenderAllowed(${eventName}, ${channel}${origins}${scopes})`;
      const guard = isBroadcast
         ? [`${i2}const ${guardName} = (${eventName}: ${eventType}) => ${allowed};`]
         : [
              `${i2}const ${guardName} = (${eventName}: ${eventType}) => {`,
              `${i3}if (!${allowed}) {`,
              `${i4}throw new IpcForbiddenError(${channel});`,
              `${i3}}`,
              `${i2}};`,
           ];
      const targetName = this.uniqueName("target", taken);
      const optionsName = this.uniqueName("options", taken);
      const unwatchName = this.uniqueName("unwatch", taken);
      const unregister = isBroadcast
         ? [`${i3}${targetName}.ipc.off(${wire}, ${listenerName});`]
         : [
              `${i3}if (${targetName}.handlers[${channel}] === ${listenerName}) {`,
              `${i4}delete ${targetName}.handlers[${channel}];`,
              `${i4}${targetName}.ipc.removeHandler(${wire});`,
              `${i3}}`,
           ];
      const names: ListenerNames = {
         event: eventName,
         callback: callbackName,
         listener: listenerName,
         remove: removeName,
         eventType,
         channel,
         isBroadcast,
         validator: validator ?? "",
         received: this.uniqueName("received", taken),
         args: this.uniqueName("args", taken),
         call: this.uniqueName("call", taken),
         spent: this.uniqueName("spent", taken),
         decoded: this.uniqueName("decoded", taken),
         serialized,
      };
      const envelope = this.usesEnvelope(spec);
      const isStream = spec.kind === "Stream";
      const argsName = this.uniqueName("rest", taken);
      const idName = this.uniqueName("id", taken);
      // Without the envelope, a serialized call still needs a wrapper that serializes the result.
      const encodesResult = serialized && spec.kind === "Unicast";
      const innerName =
         envelope || encodesResult ? this.uniqueName("handler", taken) : listenerName;
      const register = (method: string, once: boolean) => {
         const params = wrapperParams.filter(Boolean).join(", ");
         const check = isBroadcast
            ? [`${i3}if (!${guardName}(${eventName})) {`, `${i4}return;`, `${i3}}`]
            : [`${i3}${guardName}(${eventName});`];
         // With the envelope, the registered listener wraps the one that runs the handler.
         const inner = validator
            ? this.buildValidatedListener({ ...names, listener: innerName }, check, once)
            : serialized
              ? this.buildDecodedListener({ ...names, listener: innerName }, check, once)
              : [
                   `${i2}const ${innerName} = ${typeParams}(${params}) => {`,
                   ...check,
                   ...(once ? [`${i3}${removeName}();`] : []),
                   `${i3}return ${callbackName}(${forwarded.filter(Boolean).join(", ")});`,
                   `${i2}};`,
                ];
         const listener = this.buildOuterListener(spec, names, inner, {
            innerName,
            argsName,
            idName,
            envelope,
            encodesResult,
         });
         const lines = [
            `\n${i1}${method}: (${callbackName}: ${modSigDef}, ${optionsName}?: IpcListenOptions) => {`,
            ...guard,
            `${i2}const ${targetName} = resolveIpcTarget(${optionsName});`,
            `${i2}const ${removeName} = () => {`,
            `${i3}${unwatchName}();`,
            ...unregister,
            `${i2}};`,
            ...listener,
         ];
         if (isBroadcast) {
            lines.push(`${i2}${targetName}.ipc.on(${wire}, ${listenerName});`);
         } else {
            lines.push(
               `${i2}${targetName}.ipc.removeHandler(${wire});`,
               `${i2}${targetName}.ipc.handle(${wire}, ${listenerName});`,
               `${i2}${targetName}.handlers[${channel}] = ${listenerName};`,
            );
         }
         lines.push(
            `${i2}const ${unwatchName} = ${targetName}.watch(${removeName});`,
            `${i2}return ${removeName};`,
            `${i1}},`,
         );
         return lines.join("\n");
      };
      // A stream has no `handleOnce`: a call does not use up a handler that is a generator.
      const members = isBroadcast
         ? [register("on", false), register("once", true)]
         : isStream
           ? [register("handle", false)]
           : [register("handle", false), register("handleOnce", true)];
      return { name: spec.name, members };
   }
   /**
    * The listener that is registered with Electron, around the one that runs the handler. A
    * stream is started by the call, whose first argument is the ID that the page gave it. The
    * envelope settles the call, and a serialized result is encoded in the thunk that settles it.
    * Without the envelope, only a serialized result needs a wrapper.
    */
   private buildOuterListener(
      spec: t.ChannelSpec,
      n: ListenerNames,
      inner: string[],
      w: {
         innerName: string;
         argsName: string;
         idName: string;
         envelope: boolean;
         encodesResult: boolean;
      },
   ): string[] {
      const [, , i2, i3] = this.indents;
      const run = `(${w.innerName} as (...${w.argsName}: unknown[]) => unknown)(${n.event}, ...${w.argsName})`;
      const result = w.encodesResult ? `encodeValue(${n.channel}, await ${run})` : run;
      const params = `${n.event}: ${n.eventType}, ...${w.argsName}: unknown[]`;
      if (spec.kind === "Stream") {
         const start = `startStream(${n.event}, ${n.channel}, ${this.wireName(spec.name)}, ${w.idName}, ${this.getHighWaterMark(spec)}, () => ${run})`;
         return [
            ...inner,
            `${i2}const ${n.listener} = (${n.event}: ${n.eventType}, ${w.idName}: unknown, ...${w.argsName}: unknown[]) =>`,
            `${i3}settleInvoke(() => ${start});`,
         ];
      }
      if (w.envelope) {
         const settle = w.encodesResult ? `async () => ${result}` : `() => ${run}`;
         return [
            ...inner,
            `${i2}const ${n.listener} = (${params}) =>`,
            `${i3}settleInvoke(${settle});`,
         ];
      }
      return w.encodesResult
         ? [...inner, `${i2}const ${n.listener} = async (${params}) =>`, `${i3}${result};`]
         : inner;
   }
   /**
    * The lines that decode the arguments of a serialized channel, after the sender check: a call
    * that is answered throws, and a message that is not answered is logged and dropped.
    */
   private buildDecodeLines(n: ListenerNames): string[] {
      if (!n.serialized) {
         return [];
      }
      const [, , , i3, i4] = this.indents;
      return n.isBroadcast
         ? [
              `${i3}const ${n.decoded} = readSentArguments(${n.channel}, ${n.received});`,
              `${i3}if (!${n.decoded}) {`,
              `${i4}return;`,
              `${i3}}`,
           ]
         : [`${i3}const ${n.decoded} = readArguments(${n.channel}, ${n.received});`];
   }
   /**
    * The listener of a serialized channel without a validator. It takes the arguments as they
    * arrived, and calls the callback with the ones that the serializer returns, so it does not
    * declare the parameters of the signature. `check` is the sender check. A `once` listener is
    * used up by the first message that could be read.
    */
   private buildDecodedListener(n: ListenerNames, check: string[], once: boolean): string[] {
      const [, , i2, i3] = this.indents;
      return [
         `${i2}const ${n.call} = ${n.callback} as (${n.event}: ${n.eventType}, ...${n.args}: unknown[]) => unknown;`,
         `${i2}const ${n.listener} = (${n.event}: ${n.eventType}, ...${n.received}: unknown[]) => {`,
         ...check,
         ...this.buildDecodeLines(n),
         ...(once ? [`${i3}${n.remove}();`] : []),
         `${i3}return ${n.call}(${n.event}, ...${n.decoded});`,
         `${i2}};`,
      ];
   }
   /**
    * The listener of a channel with a validator. It takes the arguments as they arrived, so the
    * schema sees all of them, and the callback gets the output of the schema, so the listener
    * does not declare the parameters of the signature. `check` is the sender check.
    * A `once` listener is used up by the first valid call only. A second call may pass an
    * asynchronous schema before the first is accepted, and only one of them gets the callback.
    */
   private buildValidatedListener(n: ListenerNames, check: string[], once: boolean): string[] {
      const [, , i2, i3, i4, i5] = this.indents;
      const spentBranch = n.isBroadcast
         ? `${i5}return;`
         : `${i5}throw new Error("No handler registered for ${n.channel}");`;
      return [
         `${i2}const ${n.call} = ${n.callback} as (${n.event}: ${n.eventType}, ...${n.args}: unknown[]) => unknown;`,
         ...(once ? [`${i2}let ${n.spent} = false;`] : []),
         `${i2}const ${n.listener} = (${n.event}: ${n.eventType}, ...${n.received}: unknown[]) => {`,
         ...check,
         ...this.buildDecodeLines(n),
         `${i3}return validateArguments(${n.event}, ${n.channel}, ${n.validator}, ${n.serialized ? n.decoded : n.received}, ${n.isBroadcast}, (${n.args}) => {`,
         ...(once
            ? [
                 `${i4}if (${n.spent}) {`,
                 spentBranch,
                 `${i4}}`,
                 `${i4}${n.spent} = true;`,
                 `${i4}${n.remove}();`,
              ]
            : []),
         `${i4}return ${n.call}(${n.event}, ...${n.args});`,
         `${i3}});`,
         `${i2}};`,
      ];
   }
   /**
    * The helpers of the channels from the main process to a renderer. `resolveSendTarget` takes
    * the receiver out of what `send` or `invoke` is given: a window or a view has contents as
    * `webContents`, while a `WebContents` and a `WebFrameMain` receive the message themselves.
    * The `emit` channels also get these two. `broadcastMessage` sends to every contents that is not destroyed, optionally only to those
    * that `filter` accepts. Destroyed contents are skipped, since sending to them throws.
    * `sendToSenderFrame` replies to the frame that sent the event. Electron clears `senderFrame`
    * once the frame navigates or is destroyed, so it is read first, and a missing, destroyed or
    * detached frame is skipped, which the return value reports.
    */
   private buildSenderHelpers(emits: boolean): string {
      const [i1, i2, i3] = this.indents;
      const resolve = [
         "",
         "function resolveSendTarget(",
         `${i1}target: BrowserWindow | WebContents | WebContentsView | WebFrameMain,`,
         "): WebContents | WebFrameMain {",
         `${i1}return 'webContents' in target ? target.webContents : target;`,
         "}",
         "",
      ];
      if (!emits) {
         return resolve.join("\n");
      }
      return [
         ...resolve,
         "function broadcastMessage(",
         `${i1}channel: string,`,
         `${i1}args: unknown[],`,
         `${i1}filter?: (contents: WebContents) => boolean,`,
         "): void {",
         `${i1}for (const contents of electronWebContents.getAllWebContents()) {`,
         `${i2}if (!contents.isDestroyed() && (!filter || filter(contents))) {`,
         `${i3}contents.send(channel, ...args);`,
         `${i2}}`,
         `${i1}}`,
         "}",
         "",
         "function sendToSenderFrame(",
         `${i1}event: { readonly senderFrame: WebFrameMain | null },`,
         `${i1}channel: string,`,
         `${i1}args: unknown[],`,
         "): boolean {",
         `${i1}let frame: WebFrameMain | null = null;`,
         `${i1}try {`,
         `${i2}frame = event.senderFrame;`,
         `${i2}if (frame && (frame.isDestroyed?.() || frame.detached)) {`,
         `${i3}frame = null;`,
         `${i2}}`,
         `${i1}} catch {`,
         `${i2}frame = null;`,
         `${i1}}`,
         `${i1}if (!frame) {`,
         `${i2}return false;`,
         `${i1}}`,
         `${i1}frame.send(channel, ...args);`,
         `${i1}return true;`,
         "}",
         "",
      ].join("\n");
   }
   /**
    * `ipc.<name>.send(target, ...args)` to one window, view, contents or frame,
    * `sendToSender(event, ...args)` to the frame that sent the event, `broadcast(...args)` to
    * all contents, `broadcastTo(filter, ...args)` to those that the filter accepts, and
    * `ipc.<name>.bind(window, provider)` with a trigger. The filter comes first, since the
    * signature may end in optional or rest parameters, which would swallow an options argument.
    */
   private buildMainToRendererChannel(spec: t.ChannelSpec): ChannelEntry {
      if (spec.kind === "Unicast") {
         return this.buildAskChannel(spec);
      }
      const [, i1, i2] = this.indents;
      // The names of the generated parameters must not shadow a parameter of the signature.
      const taken = this.collectIdentifiers([spec.signature.definition]);
      const targetName = this.uniqueName("target", taken);
      const filterName = this.uniqueName("filter", taken);
      const eventName = this.uniqueName("event", taken);
      const senderParams = this.getOriginalParams(spec, true);
      const wire = this.wireName(spec.name);
      // A serialized message is one argument, the list of the arguments, as the serializer made it.
      const serialized = this.isSerializedSpec(spec);
      const wired = serialized ? `encodeValue('${spec.name}', [${senderParams}])` : senderParams;
      const sender = `resolveSendTarget(${targetName}).send(${wire}, ${wired})`;
      const ipcParams = this.getOriginalParams(spec, false);
      const typeParams = this.getTypeParams(spec.signature);
      const targetType = "BrowserWindow | WebContents | WebContentsView | WebFrameMain";
      const ipcSignature = `${typeParams}(${targetName}: ${targetType}, ${ipcParams})`;
      const filterType = `(contents: WebContents) => boolean`;
      const eventType = "{ readonly senderFrame: WebFrameMain | null }";
      const rest = serialized ? `[${wired}]` : senderParams ? `[${senderParams}]` : "[]";
      const members = [
         `\n${i1}send: ${ipcSignature} =>`,
         `\n${i2}${sender},`,
         `\n${i1}sendToSender: ${typeParams}(${eventName}: ${eventType}, ${ipcParams}) =>`,
         `\n${i2}sendToSenderFrame(${eventName}, ${wire}, ${rest}),`,
         `\n${i1}broadcast: ${typeParams}(${ipcParams}) =>`,
         `\n${i2}broadcastMessage(${wire}, ${rest}),`,
         `\n${i1}broadcastTo: ${typeParams}(${filterName}: ${filterType}, ${ipcParams}) =>`,
         `\n${i2}broadcastMessage(${wire}, ${rest}, ${filterName}),`,
      ];
      if (spec.trigger) {
         members.push(`\n${this.buildTriggerBinder(spec)}`);
      }
      return { name: spec.name, members };
   }
   /** The `IpcAskError` and `IpcAskOptions` of the `ask` channels, and of the questions to a service worker. */
   private askErrorLines(): string[] {
      const [i1, i2] = this.indents;
      return [
         "export class IpcAskError extends Error {",
         `${i1}readonly code: string | number | undefined;`,
         `${i1}readonly channel: string;`,
         `${i1}readonly data: unknown;`,
         `${i1}constructor(channel: string, message: string, code?: string | number, name = 'IpcAskError', data?: unknown) {`,
         `${i2}super(message);`,
         `${i2}this.name = name;`,
         `${i2}this.channel = channel;`,
         `${i2}this.code = code;`,
         `${i2}this.data = data;`,
         `${i1}}`,
         "}",
         "",
         "export interface IpcAskOptions {",
         `${i1}/** Rejects with the code 'IPC_ASK_TIMEOUT' when the renderer or the worker has not answered by then. */`,
         `${i1}timeoutMs?: number;`,
         "}",
         "",
      ];
   }
   /** `readAskReply`, which reads the envelope of the answer to a question. */
   private readAskReplyLines(): string[] {
      const [i1, i2] = this.indents;
      return [
         "function readAskReply(channel: string, envelope: unknown, who = 'renderer'): { value: unknown } | { error: IpcAskError } {",
         `${i1}const source = typeof envelope === 'object' && envelope !== null ? (envelope as { [key: string]: unknown }) : null;`,
         `${i1}if (source && source.ok === true) {`,
         `${i2}return { value: source.value };`,
         `${i1}}`,
         `${i1}const error = source && typeof source.error === 'object' && source.error !== null ? (source.error as { [key: string]: unknown }) : null;`,
         `${i1}if (!source || source.ok !== false || !error) {`,
         `${i2}return { error: new IpcAskError(channel, \`The \${who} sent an unreadable reply\`, 'IPC_ASK_INVALID_REPLY') };`,
         `${i1}}`,
         `${i1}const name = typeof error.name === 'string' && error.name ? error.name : 'Error';`,
         `${i1}const message = typeof error.message === 'string' ? error.message : \`The \${who} failed without a message\`;`,
         `${i1}const code = typeof error.code === 'string' || typeof error.code === 'number' ? error.code : undefined;`,
         `${i1}return { error: new IpcAskError(channel, message, code, name, error.data) };`,
         "}",
         "",
      ];
   }
   /**
    * The helpers of the `ask` channels. Electron has no invoke from the main process to a
    * renderer, so `askRenderer` sends the question with a correlation ID as its first argument,
    * and the preload script answers on the reply channel with the same ID and the envelope of the
    * `invoke` channels. Everything on the reply channel is untrusted, so a reply counts only when
    * the ID is pending for that reply channel, the sender is the contents (and frame) that was asked, and
    * the envelope has a known shape. Another renderer cannot answer for the one that was asked.
    *
    * The promise is settled once: by the answer, by the timeout, or because the contents are
    * destroyed or their renderer process is gone, whichever comes first. A frame is also checked
    * when the question is sent, but has no event of its own, so a frame that goes away
    * afterwards is caught by the destruction of its contents or by the timeout.
    * `IpcAskError` carries the `name`, `message`, `code` and `data` of an error of the responder,
    * and the code `IPC_ASK_TIMEOUT`, `IPC_ASK_DESTROYED`, `IPC_ASK_NO_HANDLER` or
    * `IPC_ASK_INVALID_REPLY` for the failures of the library itself.
    */
   private buildAskHelpers(): string {
      const [i1, i2, i3, i4] = this.indents;
      return [
         "",
         ...this.askErrorLines(),
         "interface PendingAsk {",
         `${i1}reply: string;`,
         `${i1}contents: WebContents | undefined;`,
         `${i1}frame: WebFrameMain | undefined;`,
         `${i1}answer: (envelope: unknown) => void;`,
         "}",
         "",
         "const pendingAsks: { [id: string]: unknown } = { __proto__: null };",
         "const askReplyListeners: { [reply: string]: unknown } = { __proto__: null };",
         "let lastAskId = 0;",
         "",
         "function isSameFrame(a: WebFrameMain, b: WebFrameMain): boolean {",
         `${i1}try {`,
         `${i2}return a === b || (a.processId === b.processId && a.routingId === b.routingId);`,
         `${i1}} catch {`,
         `${i2}return false;`,
         `${i1}}`,
         "}",
         "",
         "function listenForAskReplies(reply: string): void {",
         `${i1}if (askReplyListeners[reply]) {`,
         `${i2}return;`,
         `${i1}}`,
         `${i1}askReplyListeners[reply] = true;`,
         `${i1}electronIpcMain.on(reply, (event: IpcMainEvent, id: unknown, envelope: unknown) => {`,
         `${i2}const pending = typeof id === 'number' ? (pendingAsks[id] as PendingAsk | undefined) : undefined;`,
         `${i2}if (!pending || pending.reply !== reply) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}let allowed = false;`,
         `${i2}try {`,
         `${i3}const frame = event.senderFrame;`,
         `${i3}allowed =`,
         `${i4}(!pending.contents || event.sender === pending.contents) &&`,
         `${i4}(!pending.frame || (frame != null && isSameFrame(frame, pending.frame)));`,
         `${i2}} catch {`,
         `${i3}allowed = false;`,
         `${i2}}`,
         `${i2}if (allowed) {`,
         `${i3}pending.answer(envelope);`,
         `${i2}}`,
         `${i1}});`,
         "}",
         "",
         ...this.readAskReplyLines(),
         "function askRenderer(",
         `${i1}channel: string,`,
         `${i1}wire: string,`,
         `${i1}reply: string,`,
         `${i1}target: BrowserWindow | WebContents | WebContentsView | WebFrameMain,`,
         `${i1}args: unknown[],`,
         `${i1}options?: IpcAskOptions,`,
         "): Promise<unknown> {",
         `${i1}return new Promise<unknown>((resolve, reject) => {`,
         `${i2}const timeoutMs = options?.timeoutMs;`,
         `${i2}if (timeoutMs !== undefined && !(typeof timeoutMs === 'number' && timeoutMs >= 0)) {`,
         `${i3}throw new TypeError('timeoutMs must be a number which is not negative');`,
         `${i2}}`,
         `${i2}const destroyed = new IpcAskError(`,
         `${i3}channel,`,
         `${i3}\`The renderer that was asked on the channel '\${channel}' is gone\`,`,
         `${i3}'IPC_ASK_DESTROYED',`,
         `${i2});`,
         `${i2}// The webContents of a destroyed BrowserWindow throws when it is read, so the target is`,
         `${i2}// resolved under the same guard as the checks for a target that is gone.`,
         `${i2}let destination: WebContents | WebFrameMain | undefined;`,
         `${i2}let frame: WebFrameMain | undefined;`,
         `${i2}let contents: WebContents | undefined;`,
         `${i2}let isGone = false;`,
         `${i2}try {`,
         `${i3}isGone = !!(target as { isDestroyed?: () => boolean }).isDestroyed?.();`,
         `${i3}if (!isGone) {`,
         `${i4}destination = resolveSendTarget(target);`,
         `${i4}frame = 'getURL' in destination ? undefined : destination;`,
         `${i4}contents = 'getURL' in destination ? destination : electronWebContents.fromFrame(destination);`,
         `${i4}isGone = !!(contents && contents.isDestroyed()) || !!(frame && (frame.isDestroyed?.() || frame.detached));`,
         `${i3}}`,
         `${i2}} catch {`,
         `${i3}isGone = true;`,
         `${i2}}`,
         `${i2}if (isGone || !destination) {`,
         `${i3}reject(destroyed);`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}listenForAskReplies(reply);`,
         `${i2}const id = ++lastAskId;`,
         `${i2}let timer: ReturnType<typeof setTimeout> | undefined;`,
         `${i2}let onGone = (): void => undefined;`,
         `${i2}const finish = (settle: () => void): void => {`,
         `${i3}clearTimeout(timer);`,
         `${i3}delete pendingAsks[id];`,
         `${i3}contents?.removeListener('destroyed', onGone);`,
         `${i3}contents?.removeListener('render-process-gone', onGone);`,
         `${i3}settle();`,
         `${i2}};`,
         `${i2}onGone = () => finish(() => reject(destroyed));`,
         `${i2}const pending: PendingAsk = {`,
         `${i3}reply,`,
         `${i3}contents,`,
         `${i3}frame,`,
         `${i3}answer: (envelope) => {`,
         ...(this.usesSerializer()
            ? [
                 `${i4}let outcome = readAskReply(channel, envelope);`,
                 `${i4}if (!('error' in outcome)) {`,
                 `${i4}${i1}try {`,
                 `${i4}${i2}outcome = { value: decodeValue(channel, outcome.value) };`,
                 `${i4}${i1}} catch (cause) {`,
                 `${i4}${i2}outcome = { error: new IpcAskError(channel, \`The answer cannot be read: \${cause instanceof Error ? cause.message : String(cause)}\`, 'IPC_ASK_INVALID_REPLY') };`,
                 `${i4}${i1}}`,
                 `${i4}}`,
                 `${i4}const settled = outcome;`,
              ]
            : [`${i4}const settled = readAskReply(channel, envelope);`]),
         `${i4}finish(() => ('error' in settled ? reject(settled.error) : resolve(settled.value)));`,
         `${i3}},`,
         `${i2}};`,
         `${i2}pendingAsks[id] = pending;`,
         `${i2}contents?.once('destroyed', onGone);`,
         `${i2}contents?.once('render-process-gone', onGone);`,
         `${i2}if (timeoutMs !== undefined && timeoutMs !== Infinity) {`,
         `${i3}const error = new IpcAskError(`,
         `${i4}channel,`,
         `${i4}\`The renderer did not answer the channel '\${channel}' within \${timeoutMs} ms\`,`,
         `${i4}'IPC_ASK_TIMEOUT',`,
         `${i3});`,
         `${i3}timer = setTimeout(() => finish(() => reject(error)), Math.min(timeoutMs, 2147483647));`,
         `${i2}}`,
         `${i2}try {`,
         `${i3}destination.send(wire, id, ${this.usesSerializer() ? "encodeValue(channel, args)" : "...args"});`,
         `${i2}} catch (error) {`,
         `${i3}finish(() => reject(error));`,
         `${i2}}`,
         `${i1}});`,
         "}",
         "",
      ].join("\n");
   }
   /**
    * `startStream`, which the listener of a `stream` channel calls with the iterable that the
    * handler returned. It makes a `MessageChannelMain` for the call, hands one port to the frame
    * that asked, with the ID that the page chose, and drives the iterator over the other one. The
    * messages are `{ type: 'chunk', value }` in order, then `{ type: 'end' }` or
    * `{ type: 'error', error }`, and then the port is closed. The page cancels with
    * `{ type: 'cancel' }` or by closing its port, and the stream also stops when the contents are
    * destroyed. A stop calls `return()` on the iterator once, so that the generator runs its
    * `finally` blocks, and no chunk is sent after it. A chunk that cannot be cloned stops the
    * iterator and fails the stream. Everything that goes wrong before the port is handed over is
    * thrown, and reaches the page as the envelope of the call, so no port exists for it.
    *
    * The flow is controlled by credits. The page may have at most `highWaterMark` chunks that it
    * has not read, so the main process starts with a `limit` of that many chunks. It counts the
    * chunks that it sent, and does not pull from the generator once `sent` reaches `limit`.
    * The page raises the limit with `{ type: 'credit', limit }`, the total number of chunks that it
    * allows so far, as it reads. An absolute total is safe against a repeated or late message, and
    * only a higher one counts. A stop wakes the pump that waits for credit, so a cancel, a closed
    * port and a destroyed contents work while the generator is paused. With `Infinity` the
    * generator is never paused.
    */
   private buildStreamHelpers(): string {
      const [i1, i2, i3, i4, i5] = this.indents;
      return [
         "",
         "function stopIterator(iterator: AsyncIterator<unknown>): void {",
         `${i1}try {`,
         `${i2}Promise.resolve(iterator.return?.()).catch((error: unknown) => console.error(error));`,
         `${i1}} catch (error) {`,
         `${i2}console.error(error);`,
         `${i1}}`,
         "}",
         "",
         "async function startStream(",
         `${i1}event: IpcMainInvokeEvent,`,
         `${i1}channel: string,`,
         `${i1}wire: string,`,
         `${i1}id: unknown,`,
         `${i1}highWaterMark: number,`,
         `${i1}produce: () => unknown,`,
         "): Promise<void> {",
         `${i1}if (typeof id !== 'number') {`,
         `${i2}throw { name: 'IpcStreamError', message: \`The call of the channel '\${channel}' has no stream ID\`, code: 'IPC_STREAM_INVALID_REQUEST' };`,
         `${i1}}`,
         `${i1}const source = (await produce()) as { [Symbol.asyncIterator]?: () => AsyncIterator<unknown> } | null | undefined;`,
         `${i1}const open = source ? source[Symbol.asyncIterator] : undefined;`,
         `${i1}if (!source || typeof open !== 'function') {`,
         `${i2}throw { name: 'IpcStreamError', message: \`The handler of the channel '\${channel}' did not return an async iterable\`, code: 'IPC_STREAM_NOT_ITERABLE' };`,
         `${i1}}`,
         `${i1}const iterator = open.call(source);`,
         `${i1}const { port1, port2 } = new MessageChannelMain();`,
         `${i1}// The port goes to the frame that asked. A frame that is gone cannot be reached.`,
         `${i1}let target: WebContents | WebFrameMain = event.sender;`,
         `${i1}try {`,
         `${i2}const frame = event.senderFrame;`,
         `${i2}if (frame && !frame.isDestroyed?.() && !frame.detached) {`,
         `${i3}target = frame;`,
         `${i2}}`,
         `${i1}} catch {`,
         `${i2}// The sender is used instead.`,
         `${i1}}`,
         `${i1}try {`,
         `${i2}target.postMessage(\`\${wire}:port\`, id, [port2]);`,
         `${i1}} catch (error) {`,
         `${i2}port1.close();`,
         `${i2}stopIterator(iterator);`,
         `${i2}throw error;`,
         `${i1}}`,
         `${i1}const sender = event.sender;`,
         `${i1}let done = false;`,
         `${i1}let limit = highWaterMark;`,
         `${i1}let sent = 0;`,
         `${i1}let wake: (() => void) | null = null;`,
         `${i1}const resume = (): void => {`,
         `${i2}const waiting = wake;`,
         `${i2}wake = null;`,
         `${i2}waiting?.();`,
         `${i1}};`,
         `${i1}const finish = (): boolean => {`,
         `${i2}if (done) {`,
         `${i3}return false;`,
         `${i2}}`,
         `${i2}done = true;`,
         `${i2}resume();`,
         `${i2}sender.removeListener('destroyed', cancel);`,
         `${i2}port1.close();`,
         `${i2}return true;`,
         `${i1}};`,
         `${i1}const cancel = (): void => {`,
         `${i2}if (finish()) {`,
         `${i3}stopIterator(iterator);`,
         `${i2}}`,
         `${i1}};`,
         `${i1}const fail = (error: IpcErrorInfo): void => {`,
         `${i2}if (!done) {`,
         `${i3}try {`,
         `${i4}port1.postMessage({ type: 'error', error });`,
         `${i3}} catch (cause) {`,
         `${i4}console.error(cause);`,
         `${i3}}`,
         `${i3}finish();`,
         `${i2}}`,
         `${i1}};`,
         `${i1}port1.on('message', (message: { data: unknown }) => {`,
         `${i2}const data = message.data as { type?: unknown; limit?: unknown } | null;`,
         `${i2}if (data && data.type === 'cancel') {`,
         `${i3}cancel();`,
         `${i2}} else if (data && data.type === 'credit' && typeof data.limit === 'number' && data.limit > limit) {`,
         `${i3}limit = data.limit;`,
         `${i3}resume();`,
         `${i2}}`,
         `${i1}});`,
         `${i1}port1.on('close', cancel);`,
         `${i1}sender.once('destroyed', cancel);`,
         `${i1}port1.start();`,
         `${i1}const pump = async (): Promise<void> => {`,
         `${i2}while (!done) {`,
         `${i3}if (sent >= limit) {`,
         `${i4}// The page has not read enough chunks: the generator waits for credit, a cancel or a stop.`,
         `${i4}await new Promise<void>((resolve) => {`,
         `${i5}wake = resolve;`,
         `${i4}});`,
         `${i4}continue;`,
         `${i3}}`,
         `${i3}let step: IteratorResult<unknown>;`,
         `${i3}try {`,
         `${i4}step = await iterator.next();`,
         `${i3}} catch (error) {`,
         `${i4}fail(toIpcError(error));`,
         `${i4}return;`,
         `${i3}}`,
         `${i3}if (done) {`,
         `${i4}return;`,
         `${i3}}`,
         `${i3}if (step.done) {`,
         `${i4}try {`,
         `${i5}port1.postMessage({ type: 'end' });`,
         `${i4}} catch (cause) {`,
         `${i5}console.error(cause);`,
         `${i4}}`,
         `${i4}finish();`,
         `${i4}return;`,
         `${i3}}`,
         `${i3}try {`,
         `${i4}port1.postMessage({ type: 'chunk', value: ${this.usesSerializer() ? "encodeValue(channel, step.value)" : "step.value"} });`,
         `${i4}sent += 1;`,
         `${i3}} catch (error) {`,
         `${i4}stopIterator(iterator);`,
         `${i4}fail({ name: 'IpcStreamError', message: \`A chunk of the channel '\${channel}' cannot be sent: \${toIpcError(error).message}\`, code: 'IPC_STREAM_UNSENDABLE' });`,
         `${i4}return;`,
         `${i3}}`,
         `${i2}}`,
         `${i1}};`,
         `${i1}void pump();`,
         "}",
         "",
      ].join("\n");
   }
   /**
    * `ipc.<name>.invoke(target, ...args)` asks one window, view, contents or frame, and
    * `ipc.<name>.invokeWith(target, { timeoutMs }, ...args)` does so with a timeout. The options
    * come before the arguments, since a signature that ends in optional or rest parameters would
    * swallow trailing options. Both return a promise of what the responder in the renderer returns.
    */
   private buildAskChannel(spec: t.ChannelSpec): ChannelEntry {
      const [, i1, i2] = this.indents;
      // The names of the generated parameters must not shadow a parameter of the signature.
      const taken = this.collectIdentifiers([spec.signature.definition]);
      const targetName = this.uniqueName("target", taken);
      const optionsName = this.uniqueName("options", taken);
      const senderParams = this.getOriginalParams(spec, true);
      const ipcParams = this.getOriginalParams(spec, false);
      const typeParams = this.getTypeParams(spec.signature);
      const targetType = "BrowserWindow | WebContents | WebContentsView | WebFrameMain";
      const returned = spec.signature.async
         ? spec.signature.returnType
         : `Promise<Awaited<${spec.signature.returnType}>>`;
      const channel = `'${spec.name}'`;
      const rest = senderParams ? `[${senderParams}]` : "[]";
      const params = (generated: string[]) => [...generated, ipcParams].filter(Boolean).join(", ");
      const ask = (options: string) =>
         `askRenderer(${channel}, ${this.wireName(spec.name)}, ${this.wireName(spec.name, ":reply")}, ${targetName}, ${rest}${options}) as ${returned}`;
      const members = [
         `\n${i1}invoke: ${typeParams}(${params([`${targetName}: ${targetType}`])}): ${returned} =>`,
         `\n${i2}${ask("")},`,
         `\n${i1}invokeWith: ${typeParams}(${params([`${targetName}: ${targetType}`, `${optionsName}: IpcAskOptions`])}): ${returned} =>`,
         `\n${i2}${ask(`, ${optionsName}`)},`,
      ];
      return { name: spec.name, members };
   }
   /**
    * Builds `bind(browserWindow, provider)`, which registers one listener for the trigger
    * event, evaluates the provider each time the event fires and returns a disposer.
    * An error of the provider or of the send skips that send and goes to `onError`,
    * or to `console.error` without it, so that it is never an unhandled rejection.
    */
   private buildTriggerBinder(spec: t.ChannelSpec): string {
      const [, i1, i2, i3, i4, i5] = this.indents;
      const args = `[${this.getOriginalParams(spec, false)}]`;
      const provider = `provider: () => ${args} | Promise<${args}>`;
      const onError = "onError?: (error: unknown) => void";
      const event = JSON.stringify(spec.trigger);
      const typeParams = this.getTypeParams(spec.signature);
      return [
         `${i1}bind: ${typeParams}(browserWindow: BrowserWindow, ${provider}, ${onError}) => {`,
         `${i2}const listener = async () => {`,
         `${i3}try {`,
         `${i4}const args = await provider();`,
         `${i4}if (!browserWindow.isDestroyed()) {`,
         `${i5}browserWindow.webContents.send(${this.wireName(spec.name)}, ${
            this.isSerializedSpec(spec) ? `encodeValue('${spec.name}', args)` : "...args"
         });`,
         `${i4}}`,
         `${i3}} catch (error) {`,
         `${i4}(onError ?? console.error)(error);`,
         `${i3}}`,
         `${i2}};`,
         `${i2}browserWindow.on(${event}, listener);`,
         `${i2}return () => {`,
         `${i3}browserWindow.off(${event}, listener);`,
         `${i2}};`,
         `${i1}},`,
      ].join("\n");
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
    * count. `onLoad` runs once per load, and the watch starts out loaded if the contents have a
    * page and are not loading.
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
         `${i1}const start = (details?: { isMainFrame?: boolean; isSameDocument?: boolean }) => {`,
         `${i2}if (details?.isMainFrame && !details.isSameDocument) {`,
         `${i3}loaded = false;`,
         `${i3}settled = false;`,
         `${i3}failed = false;`,
         `${i2}}`,
         `${i1}};`,
         `${i1}const fail = (_event: unknown, _code: number, _description: string, _url: string, isMainFrame: boolean) => {`,
         `${i2}if (isMainFrame) {`,
         `${i3}failed = true;`,
         `${i2}}`,
         `${i1}};`,
         `${i1}const finish = () => {`,
         `${i2}loaded = true;`,
         `${i2}settled = true;`,
         `${i2}onLoad();`,
         `${i1}};`,
         `${i1}const stop = () => {`,
         `${i2}if (!settled && !failed) {`,
         `${i3}finish();`,
         `${i2}}`,
         `${i1}};`,
         `${i1}contents.on('did-start-navigation', start);`,
         `${i1}contents.on('did-fail-load', fail);`,
         `${i1}contents.on('did-finish-load', finish);`,
         `${i1}contents.on('did-stop-loading', stop);`,
         `${i1}return {`,
         `${i2}isLoaded: () => loaded,`,
         `${i2}dispose: () => {`,
         `${i3}// Destroyed contents have dropped their listeners, and cannot be reached.`,
         `${i3}if (!contents.isDestroyed()) {`,
         `${i4}contents.off('did-start-navigation', start);`,
         `${i4}contents.off('did-fail-load', fail);`,
         `${i4}contents.off('did-finish-load', finish);`,
         `${i4}contents.off('did-stop-loading', stop);`,
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
         `${i3}// A destroyed window has dropped its listeners, and cannot be reached.`,
         `${i3}if (!end.win.isDestroyed()) {`,
         `${i4}end.win.off('closed', close);`,
         `${i3}}`,
         `${i3}watches.get(end.win)?.dispose();`,
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
         `${i3}end.win.on('closed', close);`,
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
         `${i2}// Destroyed contents have dropped their listeners, and cannot be reached.`,
         `${i2}if (!contents.isDestroyed()) {`,
         `${i3}contents.off('destroyed', close);`,
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
         `${i2}contents.on('destroyed', close);`,
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
    * is made when a channel first uses the child, and listens for its messages. It is closed when
    * the child exits, which rejects the pending calls with `IPC_UTILITY_EXITED`. A child which
    * calls the main process before the main process has used the child once would not be answered,
    * so `attachUtility(child)` makes the peer right after `utilityProcess.fork`.
    */
   private buildUtilityHelpers(): string {
      const [i1] = this.indents;
      return [
         buildUtilityPeer(this.indents, this.usesSerializer()),
         "const utilityPeers = new WeakMap<UtilityProcess, UtilityPeer>();",
         "",
         "function getUtilityPeer(child: UtilityProcess): UtilityPeer {",
         `${i1}const known = utilityPeers.get(child);`,
         `${i1}if (known) {`,
         `${i1}${i1}return known;`,
         `${i1}}`,
         `${i1}const peer = createUtilityPeer((message) => child.postMessage(message));`,
         `${i1}utilityPeers.set(child, peer);`,
         `${i1}child.on('message', (message: unknown) => receiveUtilityMessage(peer, message));`,
         `${i1}child.once('exit', () => closeUtilityPeer(peer, 'The utility process exited'));`,
         `${i1}return peer;`,
         "}",
         "",
         "/** Starts listening to the child, so that its calls are answered before a channel has used it. */",
         "export function attachUtility(child: UtilityProcess): void {",
         `${i1}getUtilityPeer(child);`,
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
      const peer = `getUtilityPeer(${childName})`;
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
               `\n${i2}callUtilityPeer(${peer}, ${wire}, ${rest}${this.getTimeoutArgument(spec)}) as ${returned},`,
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
         `${i1}const linkKey = \`\${channel}:\${contents.id}\`;`,
         `${i1}const key = \`\${++lastUtilityLinkId}:utility\`;`,
         `${i1}let closed = false;`,
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
         `${i2}child.removeListener('exit', close);`,
         `${i2}if (utilityLinks.get(linkKey) === close) {`,
         `${i3}utilityLinks.delete(linkKey);`,
         `${i2}}`,
         `${i2}// Destroyed contents have dropped their listeners, and cannot be reached.`,
         `${i2}if (!contents.isDestroyed()) {`,
         `${i3}contents.off('destroyed', close);`,
         `${i3}contents.send(\`\${channel}:close\`, key);`,
         `${i2}}`,
         `${i1}};`,
         `${i1}utilityLinks.get(linkKey)?.();`,
         `${i1}// A failure from here on undoes what was registered, since the caller never gets the handle.`,
         `${i1}try {`,
         `${i2}utilityLinks.set(linkKey, close);`,
         `${i2}contents.on('destroyed', close);`,
         `${i2}child.once('exit', close);`,
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
         out.push(...this.askErrorLines(), ...this.readAskReplyLines());
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
