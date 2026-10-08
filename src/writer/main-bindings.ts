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
      return [
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
         // Globals that the generated code uses.
         "Promise",
         "Error",
         "Array",
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
      const eventTypes = new Set<string>();

      for (const parsedFileSpecs of this.pfsArray) {
         let customTypes: Set<string> = new Set();

         for (const spec of this.getChannelSpecs(parsedFileSpecs)) {
            if (spec.direction === "RendererToMain") {
               usesIpcMain = true;
               electronTypeImportsSet.add(this.getEventType(spec));
               eventTypes.add(this.getEventType(spec));
               usesHandlers ||= spec.kind !== "Broadcast";
               const validator = this.importValidator(
                  parsedFileSpecs,
                  spec,
                  importDeclarationsArray,
               );
               usesValidation ||= validator !== null;
               channels.push(this.buildRendererToMainChannel(spec, validator));
            } else if (spec.direction === "MainToRenderer") {
               electronTypeImportsSet.add("BrowserWindow");
               channels.push(this.buildMainToRendererChannel(spec));
            } else if (spec.direction === "RendererToRenderer") {
               electronImportsSet.add("MessageChannelMain");
               electronTypeImportsSet.add("BrowserWindow");
               channels.push(this.buildPortChannel(spec));
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
      const electronImports = [
         ...(usesIpcMain ? ["ipcMain as electronIpcMain"] : []),
         ...electronImportsSet,
      ];
      const out: string[] = [
         ...(electronImports.length > 0
            ? [`import { ${electronImports.join(", ")} } from "electron";`]
            : []),
         ...(electronTypeImportsSet.size > 0
            ? [`import type { ${Array.from(electronTypeImportsSet).join(", ")} } from "electron";`]
            : []),
         ...importDeclarationsArray.sort(utils.compareStrings),
      ];
      const [i0] = this.indents;
      const bindingsExpression = [];
      if (usesIpcMain) {
         bindingsExpression.push(
            this.buildSenderValidation([...eventTypes].sort(utils.compareStrings), usesValidation),
         );
      }
      if (usesValidation) {
         bindingsExpression.push(
            this.buildArgumentValidation([...eventTypes].sort(utils.compareStrings)),
         );
      }
      if (usesHandlers) {
         // The handler that each invoke channel has now, which its disposer compares against.
         // It uses no global, which a schema type could shadow, and has no prototype.
         bindingsExpression.push(
            "\nconst registeredHandlers: { [channel: string]: unknown } = { __proto__: null };\n",
         );
      }
      bindingsExpression.push("\nexport const ipc = {");
      for (const channel of this.sortChannels(channels)) {
         bindingsExpression.push(`\n${i0}${channel.name}: {`, ...channel.members, `\n${i0}},`);
      }
      bindingsExpression.push("\n}\n");

      out.push(bindingsExpression.join(""));
      return out.join("\n");
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
         `${i1}readonly channel: string;`,
         `${i1}readonly issues: readonly IpcValidationIssue[];`,
         `${i1}constructor(channel: string, issues: readonly IpcValidationIssue[]) {`,
         `${i2}super(\`The arguments of the channel '\${channel}' are invalid: \${issues.map((issue) => issue.message).join('; ')}\`);`,
         `${i2}this.name = 'IpcValidationError';`,
         `${i2}this.channel = channel;`,
         `${i2}this.issues = issues;`,
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
         ? [`${i3}electronIpcMain.off(${channel}, ${listenerName});`]
         : [
              `${i3}if (registeredHandlers[${channel}] === ${listenerName}) {`,
              `${i4}delete registeredHandlers[${channel}];`,
              `${i4}electronIpcMain.removeHandler(${channel});`,
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
      const register = (method: string, once: boolean) => {
         const params = wrapperParams.filter(Boolean).join(", ");
         const check = isBroadcast
            ? [`${i3}if (!${guardName}(${eventName})) {`, `${i4}return;`, `${i3}}`]
            : [`${i3}${guardName}(${eventName});`];
         const listener = validator
            ? this.buildValidatedListener(names, check, once)
            : [
                 `${i2}const ${listenerName} = ${typeParams}(${params}) => {`,
                 ...check,
                 ...(once ? [`${i3}${removeName}();`] : []),
                 `${i3}return ${callbackName}(${forwarded.filter(Boolean).join(", ")});`,
                 `${i2}};`,
              ];
         const lines = [
            `\n${i1}${method}: (${callbackName}: ${modSigDef}) => {`,
            ...guard,
            `${i2}const ${removeName} = () => {`,
            ...unregister,
            `${i2}};`,
            ...listener,
         ];
         if (isBroadcast) {
            lines.push(`${i2}electronIpcMain.on(${channel}, ${listenerName});`);
         } else {
            lines.push(
               `${i2}electronIpcMain.removeHandler(${channel});`,
               `${i2}electronIpcMain.handle(${channel}, ${listenerName});`,
               `${i2}registeredHandlers[${channel}] = ${listenerName};`,
            );
         }
         lines.push(`${i2}return ${removeName};`, `${i1}},`);
         return lines.join("\n");
      };
      const members = isBroadcast
         ? [register("on", false), register("once", true)]
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
   /** `ipc.<name>.send(window, ...args)`, and `ipc.<name>.bind(window, provider)` with a trigger. */
   private buildMainToRendererChannel(spec: t.ChannelSpec): ChannelEntry {
      const [, i1, i2] = this.indents;
      // The name of the window parameter must not shadow a parameter of the signature.
      const taken = this.collectIdentifiers([spec.signature.definition]);
      const windowName = this.uniqueName("browserWindow", taken);
      const senderParams = this.getOriginalParams(spec, true);
      const sender = `${windowName}.webContents.send('${spec.name}', ${senderParams})`;
      const ipcParams = this.getOriginalParams(spec, false);
      const typeParams = this.getTypeParams(spec.signature);
      const ipcSignature = `${typeParams}(${windowName}: BrowserWindow, ${ipcParams})`;
      const members = [`\n${i1}send: ${ipcSignature} =>`, `\n${i2}${sender},`];
      if (spec.trigger) {
         members.push(`\n${this.buildTriggerBinder(spec)}`);
      }
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
         `${i5}browserWindow.webContents.send('${spec.name}', ...args);`,
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
   /** `ipc.<name>.connect(winA, winB)`, which hands one end of a new port to each window. */
   private buildPortChannel(spec: t.ChannelSpec): ChannelEntry {
      const [, i1, i2, i3] = this.indents;
      const connector = [
         `\n${i1}connect: (winA: BrowserWindow, winB: BrowserWindow) => {`,
         `${i2}const { port1, port2 } = new MessageChannelMain();`,
         `${i2}winA.once('ready-to-show', () => {`,
         `${i3}winA.webContents.postMessage('${spec.name}', null, [port1]);`,
         `${i2}});`,
         `${i2}winB.once('ready-to-show', () => {`,
         `${i3}winB.webContents.postMessage('${spec.name}', null, [port2]);`,
         `${i2}});`,
         `${i1}},`,
      ].join("\n");
      return { name: spec.name, members: [connector] };
   }
}
