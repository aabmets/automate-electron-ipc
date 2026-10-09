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

import { UTILITY_RUNTIME_NAMES } from "../utility/utility-runtime.js";
import { WORKER_RESERVED_NAMES } from "./main-workers.js";

/** What the generated `main.ts` uses, which decides the names that it reserves. */
interface ReservedNameUses {
   rendererPorts: boolean;
   mainPorts: boolean;
   brokered: boolean;
   serializer: boolean;
   eventWatch: boolean;
   utility: boolean;
   workers: boolean;
}

/**
 * The names that the generated `main.ts` declares, imports or uses, which a schema type of the same
 * name must not shadow.
 */
export function getMainReservedNames(uses: ReservedNameUses): string[] {
   // The globals that only the helpers of port channels use.
   const portGlobals = uses.rendererPorts || uses.mainPorts;
   return [
      ...(portGlobals ? ["Map", "Set"] : uses.brokered ? ["Map"] : []),
      ...(uses.mainPorts ? ["Function"] : []),
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
      ...(uses.serializer
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
      ...(uses.eventWatch ? ["WeakMap"] : []),
      // The channels to a utility process.
      ...(uses.utility
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
      ...(uses.workers ? WORKER_RESERVED_NAMES : []),
   ];
}
