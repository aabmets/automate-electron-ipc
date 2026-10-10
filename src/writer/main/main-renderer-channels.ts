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
import type { ChannelEntry, MainContext } from "./main-bindings.js";
import {
   buildDecodedListener,
   buildOuterListener,
   buildValidatedListener,
   type ListenerNames,
} from "./main-listeners.js";

/**
 * Whether the results and errors of the handler of the channel are sent as an envelope. A
 * stream always does, since the start of a stream has no error of Electron's to leave it to.
 */
export function hasEnvelope(ctx: MainContext, spec: t.ChannelSpec): boolean {
   return spec.kind === "Stream" || (spec.kind === "Unicast" && !ctx.config.rawErrors);
}

/**
 * Electron passes an `IpcMainInvokeEvent` to `handle` listeners and an `IpcMainEvent`
 * to `on` listeners.
 */
export function getEventType(spec: t.ChannelSpec): string {
   return spec.kind === "Broadcast" ? "IpcMainEvent" : "IpcMainInvokeEvent";
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
export function buildRendererToMainChannel(
   ctx: MainContext,
   spec: t.ChannelSpec,
   validator: string | null,
): ChannelEntry {
   const [, i1, i2, i3, i4] = ctx.indents;
   const eventType = getEventType(spec);
   // The names of the generated parameters must not shadow the ones of the signature, nor
   // the validator, which the listener refers to.
   const taken = ctx.collectIdentifiers([spec.signature.definition, validator ?? ""]);
   const eventName = ctx.uniqueName("event", taken);
   const callbackName = ctx.uniqueName("callback", taken);
   const listenerName = ctx.uniqueName("listener", taken);
   const wrapperParams = [`${eventName}: ${eventType}`, ctx.getOriginalParams(spec, false)];
   const forwarded = [eventName, ctx.getOriginalParams(spec, true)];
   const typeParams = ctx.getTypeParams(spec.signature);
   const modSigDef = ctx.injectEventTypehint(spec.signature, eventType, eventName);
   const channel = `'${spec.name}'`;
   const wire = ctx.wireName(spec.name);
   const isBroadcast = spec.kind === "Broadcast";
   // The origins come before the scopes, so a channel with scopes only passes `undefined` for them.
   const scopeList = spec.scopes?.map((scope) => `'${scope}'`).join(", ");
   const scopes = spec.scopes ? `, [${scopeList}]` : "";
   const originList = spec.allowedOrigins?.map((origin) => JSON.stringify(origin)).join(", ");
   let origins = "";
   if (spec.allowedOrigins) {
      origins = `, [${originList}]`;
   } else if (scopes) {
      origins = ", undefined";
   }
   // The generated names that the listener calls must not be shadowed by its parameters,
   // so the listener only calls the local functions below, whose names are unique.
   const serialized = ctx.isSerializedSpec(spec);
   const guardName = ctx.uniqueName("guard", taken);
   const removeName = ctx.uniqueName("remove", taken);
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
   const targetName = ctx.uniqueName("target", taken);
   const optionsName = ctx.uniqueName("options", taken);
   const unwatchName = ctx.uniqueName("unwatch", taken);
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
      received: ctx.uniqueName("received", taken),
      args: ctx.uniqueName("args", taken),
      call: ctx.uniqueName("call", taken),
      spent: ctx.uniqueName("spent", taken),
      decoded: ctx.uniqueName("decoded", taken),
      serialized,
   };
   const envelope = hasEnvelope(ctx, spec);
   const isStream = spec.kind === "Stream";
   const argsName = ctx.uniqueName("rest", taken);
   const idName = ctx.uniqueName("id", taken);
   // Without the envelope, a serialized call still needs a wrapper that serializes the result.
   const encodesResult = serialized && spec.kind === "Unicast";
   const innerName = envelope || encodesResult ? ctx.uniqueName("handler", taken) : listenerName;
   const register = (method: string, once: boolean) => {
      const params = wrapperParams.filter(Boolean).join(", ");
      const check = isBroadcast
         ? [`${i3}if (!${guardName}(${eventName})) {`, `${i4}return;`, `${i3}}`]
         : [`${i3}${guardName}(${eventName});`];
      // With the envelope, the registered listener wraps the one that runs the handler.
      const innerNames = { ...names, listener: innerName };
      let inner: string[];
      if (validator) {
         inner = buildValidatedListener(ctx.indents, innerNames, check, once);
      } else if (serialized) {
         inner = buildDecodedListener(ctx.indents, innerNames, check, once);
      } else {
         inner = [
            `${i2}const ${innerName} = ${typeParams}(${params}) => {`,
            ...check,
            ...(once ? [`${i3}${removeName}();`] : []),
            `${i3}return ${callbackName}(${forwarded.filter(Boolean).join(", ")});`,
            `${i2}};`,
         ];
      }
      const listener = buildOuterListener(ctx, spec, names, inner, {
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
      const watchChannel = isBroadcast ? "" : `, ${channel}`;
      lines.push(
         `${i2}const ${unwatchName} = ${targetName}.watch(${removeName}${watchChannel});`,
         `${i2}return ${removeName};`,
         `${i1}},`,
      );
      return lines.join("\n");
   };
   // A stream has no `handleOnce`: a call does not use up a handler that is a generator.
   let members: string[];
   if (isBroadcast) {
      members = [register("on", false), register("once", true)];
   } else if (isStream) {
      members = [register("handle", false)];
   } else {
      members = [register("handle", false), register("handleOnce", true)];
   }
   return { name: spec.name, members };
}
