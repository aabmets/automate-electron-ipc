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
import utils from "../utils.js";
import { BaseWriter } from "./base-writer.js";

interface ChannelEntry {
   name: string;
   /** The members of the channel object, one per line, indented for the object body. */
   members: string[];
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
}

export class MainBindingsWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.config.mainBindingsFilePath;
   }
   protected getReservedNames(): string[] {
      // The globals that only the helpers of port channels use.
      const portGlobals = this.hasPorts("RendererToRenderer") || this.hasPorts("MainToRenderer");
      return [
         ...(portGlobals ? ["Map", "Set"] : []),
         ...(this.hasPorts("MainToRenderer") ? ["Function"] : []),
         "ipc",
         "electronIpcMain",
         "MessageChannelMain",
         "BrowserWindow",
         "IpcMainEvent",
         "IpcMainInvokeEvent",
         // Declared by the generated code.
         "registeredHandlers",
         "IpcForbiddenError",
         "IpcConfig",
         "ipcConfig",
         "configureIpc",
         "isSenderAllowed",
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
      ];
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
      let usesHandlers = false;
      let usesValidation = false;
      let usesEnvelope = false;
      let usesSenders = false;
      let usesStreams = false;
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
               usesHandlers ||= spec.kind !== "Broadcast";
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
            }
            const specCustomTypes = new Set(spec.signature.customTypes);
            customTypes = customTypes.union(specCustomTypes);
         }
         for (const customType of customTypes) {
            const importDeclaration = this.importsGenerator.getDeclaration(
               parsedFileSpecs,
               customType,
            );
            if (importDeclaration) {
               importDeclarationsArray.push(importDeclaration);
            }
         }
      }
      this.addStreamImports(usesStreams, electronImportsSet, electronTypeImportsSet);
      const usesAsks = this.hasChannels("Unicast");
      const usesEmits = this.hasChannels("Broadcast");
      const usesRendererPorts = this.hasPorts("RendererToRenderer");
      const usesMainPorts = this.hasPorts("MainToRenderer");
      const usesPorts = usesRendererPorts || usesMainPorts;
      const out = this.buildImports(
         [
            ...(usesIpcMain || usesAsks || usesPorts ? ["ipcMain as electronIpcMain"] : []),
            ...electronImportsSet,
         ],
         [...electronTypeImportsSet],
         importDeclarationsArray,
      );
      const [i0] = this.indents;
      const bindingsExpression = this.buildSupport(
         {
            usesIpcMain,
            usesHandlers,
            usesValidation,
            usesEnvelope,
            usesSenders,
            usesEmits,
            usesAsks,
            usesPorts,
            usesRendererPorts,
            usesMainPorts,
            usesStreams,
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
         usesHandlers: boolean;
         usesValidation: boolean;
         usesEnvelope: boolean;
         usesSenders: boolean;
         usesEmits: boolean;
         usesAsks: boolean;
         usesPorts: boolean;
         usesRendererPorts: boolean;
         usesMainPorts: boolean;
         usesStreams: boolean;
      },
      eventTypes: string[],
   ): string[] {
      const support: string[] = [];
      if (uses.usesIpcMain) {
         support.push(this.buildSenderValidation(eventTypes, uses.usesValidation));
      }
      if (uses.usesValidation) {
         support.push(this.buildArgumentValidation(eventTypes));
      }
      if (uses.usesEnvelope) {
         support.push(this.buildErrorEnvelope());
      }
      if (uses.usesSenders) {
         support.push(this.buildSenderHelpers(uses.usesEmits));
      }
      if (uses.usesAsks) {
         support.push(this.buildAskHelpers());
      }
      if (uses.usesStreams) {
         support.push(this.buildStreamHelpers());
      }
      if (uses.usesPorts) {
         support.push(this.buildPortRegistry());
      }
      if (uses.usesRendererPorts) {
         support.push(this.buildPortHelpers());
      }
      if (uses.usesMainPorts) {
         support.push(this.buildMainPortHelpers());
      }
      if (uses.usesHandlers) {
         // The handler that each invoke channel has now, which its disposer compares against.
         // It uses no global, which a schema type could shadow, and has no prototype.
         support.push(
            "\nconst registeredHandlers: { [channel: string]: unknown } = { __proto__: null };\n",
         );
      }
      return support;
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
      const [i1, i2, i3] = this.indents;
      return [
         "",
         "interface IpcErrorInfo {",
         `${i1}name: string;`,
         `${i1}message: string;`,
         `${i1}code?: string | number;`,
         `${i1}data?: unknown;`,
         "}",
         "",
         "type IpcEnvelope = { ok: true; value: unknown } | { ok: false; error: IpcErrorInfo };",
         "",
         "function toIpcError(error: unknown): IpcErrorInfo {",
         `${i1}try {`,
         `${i2}const source = typeof error === 'object' && error !== null ? (error as { [key: string]: unknown }) : null;`,
         `${i2}const name = source && typeof source.name === 'string' && source.name ? source.name : 'Error';`,
         `${i2}const message = source && typeof source.message === 'string' ? source.message : String(error);`,
         `${i2}const info: IpcErrorInfo = { name, message };`,
         `${i2}if (source && (typeof source.code === 'string' || typeof source.code === 'number')) {`,
         `${i3}info.code = source.code;`,
         `${i2}}`,
         `${i2}if (source && source.data !== undefined) {`,
         `${i3}try {`,
         `${i3}${i1}info.data = structuredClone(source.data);`,
         `${i3}} catch {`,
         `${i3}${i1}// Data that cannot be cloned is left out.`,
         `${i3}}`,
         `${i2}}`,
         `${i2}return info;`,
         `${i1}} catch {`,
         `${i2}return { name: 'Error', message: 'The handler failed with an unreadable error' };`,
         `${i1}}`,
         "}",
         "",
         "async function settleInvoke(run: () => unknown): Promise<IpcEnvelope> {",
         `${i1}try {`,
         `${i2}return { ok: true, value: await run() };`,
         `${i1}} catch (error) {`,
         `${i2}return { ok: false, error: toIpcError(error) };`,
         `${i1}}`,
         "}",
         "",
      ].join("\n");
   }
   /**
    * Electron passes an `IpcMainInvokeEvent` to `handle` listeners and an `IpcMainEvent`
    * to `on` listeners.
    */
   private getEventType(spec: t.ChannelSpec): string {
      return spec.kind === "Broadcast" ? "IpcMainEvent" : "IpcMainInvokeEvent";
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
   private buildSenderValidation(eventTypes: string[], usesValidation: boolean): string {
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
         `function isSenderAllowed(event: ${event}, channel: string, allowedOrigins?: string[]): boolean {`,
         `${i1}const validateSender = ipcConfig.validateSender;`,
         `${i1}if (!allowedOrigins && !validateSender) {`,
         `${i2}return true;`,
         `${i1}}`,
         `${i1}let allowed = false;`,
         `${i1}try {`,
         `${i2}const frame = event.senderFrame;`,
         `${i2}const origin = frame ? frame.origin : null;`,
         `${i2}allowed =`,
         `${i3}frame != null &&`,
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
    */
   private buildArgumentValidation(eventTypes: string[]): string {
      const [i1, i2, i3] = this.indents;
      const event = eventTypes.join(" | ");
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
         "): R | Promise<R | undefined> | undefined {",
         `${i1}const reject = (issues: readonly IpcValidationIssue[]): undefined => {`,
         `${i2}const error = new IpcValidationError(channel, issues);`,
         `${i2}try {`,
         `${i3}ipcConfig.onRejected?.(event, channel, error);`,
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
      const origins = spec.allowedOrigins
         ? `, [${spec.allowedOrigins.map((origin) => JSON.stringify(origin)).join(", ")}]`
         : "";
      // The generated names that the listener calls must not be shadowed by its parameters,
      // so the listener only calls the local functions below, whose names are unique.
      const guardName = this.uniqueName("guard", taken);
      const removeName = this.uniqueName("remove", taken);
      const allowed = `isSenderAllowed(${eventName}, ${channel}${origins})`;
      const guard = isBroadcast
         ? [`${i2}const ${guardName} = (${eventName}: ${eventType}) => ${allowed};`]
         : [
              `${i2}const ${guardName} = (${eventName}: ${eventType}) => {`,
              `${i3}if (!${allowed}) {`,
              `${i4}throw new IpcForbiddenError(${channel});`,
              `${i3}}`,
              `${i2}};`,
           ];
      const unregister = isBroadcast
         ? [`${i3}electronIpcMain.off(${wire}, ${listenerName});`]
         : [
              `${i3}if (registeredHandlers[${channel}] === ${listenerName}) {`,
              `${i4}delete registeredHandlers[${channel}];`,
              `${i4}electronIpcMain.removeHandler(${wire});`,
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
      };
      const envelope = this.usesEnvelope(spec);
      const isStream = spec.kind === "Stream";
      const argsName = this.uniqueName("rest", taken);
      const idName = this.uniqueName("id", taken);
      const innerName = envelope ? this.uniqueName("handler", taken) : listenerName;
      const register = (method: string, once: boolean) => {
         const params = wrapperParams.filter(Boolean).join(", ");
         const check = isBroadcast
            ? [`${i3}if (!${guardName}(${eventName})) {`, `${i4}return;`, `${i3}}`]
            : [`${i3}${guardName}(${eventName});`];
         // With the envelope, the registered listener wraps the one that runs the handler.
         const inner = validator
            ? this.buildValidatedListener({ ...names, listener: innerName }, check, once)
            : [
                 `${i2}const ${innerName} = ${typeParams}(${params}) => {`,
                 ...check,
                 ...(once ? [`${i3}${removeName}();`] : []),
                 `${i3}return ${callbackName}(${forwarded.filter(Boolean).join(", ")});`,
                 `${i2}};`,
              ];
         // A stream is started by the call: the first argument is the ID that the page gave it.
         const run = `(${innerName} as (...${argsName}: unknown[]) => unknown)(${eventName}, ...${argsName})`;
         const listener = isStream
            ? [
                 ...inner,
                 `${i2}const ${listenerName} = (${eventName}: ${eventType}, ${idName}: unknown, ...${argsName}: unknown[]) =>`,
                 `${i3}settleInvoke(() => startStream(${eventName}, ${channel}, ${wire}, ${idName}, () => ${run}));`,
              ]
            : envelope
              ? [
                   ...inner,
                   `${i2}const ${listenerName} = (${eventName}: ${eventType}, ...${argsName}: unknown[]) =>`,
                   `${i3}settleInvoke(() => ${run});`,
                ]
              : inner;
         const lines = [
            `\n${i1}${method}: (${callbackName}: ${modSigDef}) => {`,
            ...guard,
            `${i2}const ${removeName} = () => {`,
            ...unregister,
            `${i2}};`,
            ...listener,
         ];
         if (isBroadcast) {
            lines.push(`${i2}electronIpcMain.on(${wire}, ${listenerName});`);
         } else {
            lines.push(
               `${i2}electronIpcMain.removeHandler(${wire});`,
               `${i2}electronIpcMain.handle(${wire}, ${listenerName});`,
               `${i2}registeredHandlers[${channel}] = ${listenerName};`,
            );
         }
         lines.push(`${i2}return ${removeName};`, `${i1}},`);
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
         `${i3}return validateArguments(${n.event}, ${n.channel}, ${n.validator}, ${n.received}, ${n.isBroadcast}, (${n.args}) => {`,
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
      const sender = `resolveSendTarget(${targetName}).send(${wire}, ${senderParams})`;
      const ipcParams = this.getOriginalParams(spec, false);
      const typeParams = this.getTypeParams(spec.signature);
      const targetType = "BrowserWindow | WebContents | WebContentsView | WebFrameMain";
      const ipcSignature = `${typeParams}(${targetName}: ${targetType}, ${ipcParams})`;
      const filterType = `(contents: WebContents) => boolean`;
      const eventType = "{ readonly senderFrame: WebFrameMain | null }";
      const rest = senderParams ? `[${senderParams}]` : "[]";
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
         `${i1}/** Rejects with the code 'IPC_ASK_TIMEOUT' when the renderer has not answered by then. */`,
         `${i1}timeoutMs?: number;`,
         "}",
         "",
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
         "function readAskReply(channel: string, envelope: unknown): { value: unknown } | { error: IpcAskError } {",
         `${i1}const source = typeof envelope === 'object' && envelope !== null ? (envelope as { [key: string]: unknown }) : null;`,
         `${i1}if (source && source.ok === true) {`,
         `${i2}return { value: source.value };`,
         `${i1}}`,
         `${i1}const error = source && typeof source.error === 'object' && source.error !== null ? (source.error as { [key: string]: unknown }) : null;`,
         `${i1}if (!source || source.ok !== false || !error) {`,
         `${i2}return { error: new IpcAskError(channel, 'The renderer sent an unreadable reply', 'IPC_ASK_INVALID_REPLY') };`,
         `${i1}}`,
         `${i1}const name = typeof error.name === 'string' && error.name ? error.name : 'Error';`,
         `${i1}const message = typeof error.message === 'string' ? error.message : 'The renderer failed without a message';`,
         `${i1}const code = typeof error.code === 'string' || typeof error.code === 'number' ? error.code : undefined;`,
         `${i1}return { error: new IpcAskError(channel, message, code, name, error.data) };`,
         "}",
         "",
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
         `${i4}const outcome = readAskReply(channel, envelope);`,
         `${i4}finish(() => ('error' in outcome ? reject(outcome.error) : resolve(outcome.value)));`,
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
         `${i3}destination.send(wire, id, ...args);`,
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
    * The generator is not slowed down for a page that reads slowly: there is no backpressure.
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
         `${i1}const finish = (): boolean => {`,
         `${i2}if (done) {`,
         `${i3}return false;`,
         `${i2}}`,
         `${i2}done = true;`,
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
         `${i2}const data = message.data as { type?: unknown } | null;`,
         `${i2}if (data && data.type === 'cancel') {`,
         `${i3}cancel();`,
         `${i2}}`,
         `${i1}});`,
         `${i1}port1.on('close', cancel);`,
         `${i1}sender.once('destroyed', cancel);`,
         `${i1}port1.start();`,
         `${i1}const pump = async (): Promise<void> => {`,
         `${i2}while (!done) {`,
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
         `${i4}port1.postMessage({ type: 'chunk', value: step.value });`,
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
         `${i5}browserWindow.webContents.send(${this.wireName(spec.name)}, ...args);`,
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
    *
    * `watchPageLoad` tells when the page of some contents has loaded, which a port has to wait for,
    * since one that is posted earlier arrives before the preload script listens for it. It cannot
    * ask `isLoading()`: Electron keeps it `true` while `did-finish-load` fires, and after
    * `loadURL` has resolved, until `did-stop-loading`. So the page counts as loaded from every
    * `did-finish-load`, and from the `did-stop-loading` of a load that `did-finish-load` has not
    * reported, such as one that finished before the watch began. A failed main-frame load does not
    * count. `onLoad` runs once per load, and the watch starts out loaded if the contents have a
    * page and are not loading.
    */
   private buildPortRegistry(): string {
      const [i1, i2, i3, i4] = this.indents;
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
    * window is destroyed.
    */
   private buildPortHelpers(): string {
      const [i1, i2, i3, i4] = this.indents;
      return [
         "",
         "function connectPorts(channel: string, winA: BrowserWindow, winB: BrowserWindow): { close: () => void } {",
         `${i1}const id = ++lastPortConnectionId;`,
         `${i1}const ends = [`,
         `${i2}{ key: \`\${id}:a\`, win: winA },`,
         `${i2}{ key: \`\${id}:b\`, win: winB },`,
         `${i1}];`,
         `${i1}const windows = winA === winB ? [winA] : [winA, winB];`,
         `${i1}let closed = false;`,
         `${i1}const watches = new Map<BrowserWindow, PageLoadWatch>();`,
         `${i1}const isReady = (win: BrowserWindow) => !win.isDestroyed() && !!watches.get(win)?.isLoaded();`,
         `${i1}const pair = () => {`,
         `${i2}if (closed || !isReady(winA) || !isReady(winB)) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}const { port1, port2 } = new MessageChannelMain();`,
         `${i2}winA.webContents.postMessage(channel, ends[0].key, [port1]);`,
         `${i2}winB.webContents.postMessage(channel, ends[1].key, [port2]);`,
         `${i1}};`,
         `${i1}const close = () => {`,
         `${i2}if (closed) {`,
         `${i3}return;`,
         `${i2}}`,
         `${i2}closed = true;`,
         `${i2}for (const win of windows) {`,
         `${i3}// A destroyed window has dropped its listeners, and cannot be reached.`,
         `${i3}if (!win.isDestroyed()) {`,
         `${i4}win.off('closed', close);`,
         `${i3}}`,
         `${i3}watches.get(win)?.dispose();`,
         `${i2}}`,
         `${i2}for (const end of ends) {`,
         `${i3}portEnds.delete(end.key);`,
         `${i3}if (!end.win.isDestroyed()) {`,
         `${i4}end.win.webContents.send(\`\${channel}:close\`, end.key);`,
         `${i3}}`,
         `${i2}}`,
         `${i1}};`,
         `${i1}for (const end of ends) {`,
         `${i2}portEnds.set(end.key, { contents: end.win.webContents, close });`,
         `${i1}}`,
         `${i1}listenForPortDisconnects(channel);`,
         `${i1}for (const win of windows) {`,
         `${i2}win.on('closed', close);`,
         `${i2}watches.set(win, watchPageLoad(win.webContents, pair));`,
         `${i1}}`,
         `${i1}pair();`,
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
    */
   private buildMainPortHelpers(): string {
      const [i1, i2, i3, i4, i5] = this.indents;
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
         `${i3}if (port === next && Array.isArray(event.data)) {`,
         `${i4}notifyMainPortListeners(subscribers, event.data);`,
         `${i3}}`,
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
         `${i4}next.postMessage(args);`,
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
         `${i1}portEnds.set(key, { contents, close });`,
         `${i1}listenForPortDisconnects(channel);`,
         `${i1}contents.on('destroyed', close);`,
         `${i1}pair();`,
         `${i1}return {`,
         `${i2}send: (...args: any[]) => {`,
         `${i3}if (closed) {`,
         `${i4}return;`,
         `${i3}}`,
         `${i3}if (port) {`,
         `${i4}port.postMessage(args);`,
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
}
