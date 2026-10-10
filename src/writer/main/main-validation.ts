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
import utils from "../../utils.js";
import type { ImportsGenerator } from "../imports-generator.js";
import { getWorkerEventType } from "./main-workers.js";

/**
 * Imports the validator of the channel, if it has one, and returns its local name. The import
 * line goes to `declarations` once, however many channels use the same validator.
 */
export function importValidator(
   importsGenerator: ImportsGenerator,
   pfs: t.ParsedFileSpecs,
   spec: t.ChannelSpec,
   declarations: string[],
): string | null {
   if (!spec.validate) {
      return null;
   }
   const imported = importsGenerator.getValueImport(pfs, spec.validate);
   if (imported.declaration) {
      declarations.push(imported.declaration);
   }
   return imported.local;
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
export function buildSenderValidation(
   indents: string[],
   eventTypes: string[],
   usesValidation: boolean,
   usesScopes: boolean,
): string {
   const [i1, i2, i3] = indents;
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
export function buildArgumentValidation(
   indents: string[],
   eventTypes: string[],
   workerEvents: string[],
): string {
   const [i1, i2, i3] = indents;
   const pageEvent = eventTypes.join(" | ");
   const workerEvent = workerEvents.join(" | ");
   const event = [...eventTypes, ...workerEvents].join(" | ");
   const hasPages = eventTypes.length > 0;
   const hasWorkers = workerEvents.length > 0;
   // The page hook is called when no `report` is given. A file with only worker calls has no such hook.
   let notify = [`${i3}ipcConfig.onRejected?.(event, channel, error);`];
   if (hasWorkers && hasPages) {
      notify = [
         `${i3}if (report) {`,
         `${i3}${i1}report(event as ${workerEvent}, channel, error);`,
         `${i3}} else {`,
         `${i3}${i1}ipcConfig.onRejected?.(event as ${pageEvent}, channel, error);`,
         `${i3}}`,
      ];
   } else if (hasWorkers) {
      notify = [`${i3}report(event as ${workerEvent}, channel, error);`];
   }
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
export function getValidatedWorkerEvents(validators: Map<t.ChannelSpec, string>): string[] {
   const events = new Set<string>();
   for (const spec of validators.keys()) {
      events.add(getWorkerEventType(spec));
   }
   return [...events].sort(utils.compareStrings);
}
