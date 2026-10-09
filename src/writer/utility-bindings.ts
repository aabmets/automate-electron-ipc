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
import {
   hasBrokeredChannels,
   hasUtilityChannels,
   isBrokeredSpec,
   isUtilitySpec,
} from "./channel-kinds.js";
import { collectIdentifiers, uniqueName } from "./param-names.js";
import { buildBrokerServer } from "./utility-broker.js";
import { buildUtilityPeer } from "./utility-peer.js";
import {
   buildErrorEnvelope,
   buildSerializerImport,
   buildSerializerRuntime,
   UTILITY_RUNTIME_NAMES,
} from "./utility-runtime.js";

interface ChannelEntry {
   name: string;
   /** The members of the channel object, one per line, indented for the object body. */
   members: string[];
}

/**
 * Writes `utility.ts`, the bindings for the code that runs in a utility process (`utilityProcess.fork`).
 * It talks to the main process over `process.parentPort`, and needs no import from `electron`.
 * It is written only when the schema has a channel between the main process and a utility process.
 */
export class UtilityBindingsWriter extends BaseWriter {
   protected getTargetFilePath(): string {
      return this.config.utilityBindingsFilePath;
   }
   protected getReservedNames(): string[] {
      return [
         ...UTILITY_RUNTIME_NAMES,
         "ipc",
         "UtilityParentPort",
         "utilityPeer",
         "getUtilityPeer",
         "globalThis",
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
              ]
            : []),
         // The code which serves the ports that the main process brokers for pages.
         ...(hasBrokeredChannels(this.pfsArray)
            ? [
                 "BrokerPort",
                 "BrokerStream",
                 "brokerCalls",
                 "brokerStreams",
                 "brokerWindows",
                 "brokerChannels",
                 "setBrokerCall",
                 "setBrokerStream",
                 "stopBrokerIterator",
                 "runBrokeredStream",
                 "serveBrokeredPort",
                 "acceptBrokeredPort",
                 "Symbol",
                 "AsyncIterator",
                 "IteratorResult",
              ]
            : []),
      ];
   }
   /** The file only holds the channels with the main process and with the pages over brokered ports. */
   protected isSerializedSpec(spec: t.ChannelSpec): boolean {
      return this.usesSerializer() && (isUtilitySpec(spec) || isBrokeredSpec(spec));
   }
   /** Whether the schema has anything for this file, which is not written otherwise. */
   public hasChannels(): boolean {
      return hasUtilityChannels(this.pfsArray);
   }
   protected renderEmptyFileContents(): string {
      return "export const ipc = {};";
   }
   protected renderFileContents(): string {
      const channels: ChannelEntry[] = [];
      const importDeclarations: string[] = [];
      for (const parsedFileSpecs of this.pfsArray) {
         const customTypes = new Set<string>();
         for (const spec of this.getChannelSpecs(parsedFileSpecs)) {
            if (!(isUtilitySpec(spec) || isBrokeredSpec(spec))) {
               continue;
            }
            channels.push(this.buildChannel(spec));
            for (const customType of spec.signature.customTypes) {
               customTypes.add(customType);
            }
         }
         for (const customType of customTypes) {
            const declaration = this.importsGenerator.getDeclaration(parsedFileSpecs, customType);
            if (declaration) {
               importDeclarations.push(declaration);
            }
         }
      }
      const out = importDeclarations.sort(utils.compareStrings);
      const brokered = this.getBrokeredSpecs();
      if (this.hasSerializedChannels()) {
         out.push(buildSerializerImport(this.config, this.importsGenerator));
      }
      out.push(
         ...(this.hasSerializedChannels() ? [buildSerializerRuntime(this.indents)] : []),
         buildErrorEnvelope(this.indents),
         buildUtilityPeer(this.indents, this.usesSerializer()),
         this.buildParentPort(brokered.length > 0),
         ...(brokered.length > 0 ? [this.buildBrokerServer(brokered)] : []),
         this.buildBindings(channels),
      );
      return this.joinComponents(out);
   }
   /**
    * The peer of the main process, which is made when a channel is first used. The port is read
    * from `process.parentPort`, which exists only in a utility process, so the file can be
    * imported anywhere and fails with a clear error when a channel is used elsewhere. Electron
    * queues the messages of the main process until a listener is added, so none is lost in between.
    */
   private buildParentPort(brokers: boolean): string {
      const [i1, i2, i3] = this.indents;
      const event = brokers ? "{ data: unknown; ports?: BrokerPort[] }" : "{ data: unknown }";
      const receive = brokers
         ? [
              `${i1}port.on('message', (event) => {`,
              `${i2}if (!acceptBrokeredPort(event)) {`,
              `${i3}receiveUtilityMessage(peer, event.data);`,
              `${i2}}`,
              `${i1}});`,
           ]
         : [`${i1}port.on('message', (event) => receiveUtilityMessage(peer, event.data));`];
      return [
         "interface UtilityParentPort {",
         `${i1}on: (event: 'message', listener: (event: ${event}) => void) => unknown;`,
         `${i1}postMessage: (message: unknown) => void;`,
         "}",
         "",
         "let utilityPeer: UtilityPeer | undefined;",
         "",
         "function getUtilityPeer(): UtilityPeer {",
         `${i1}if (utilityPeer) {`,
         `${i1}${i1}return utilityPeer;`,
         `${i1}}`,
         `${i1}const port = (globalThis as unknown as { process?: { parentPort?: UtilityParentPort } }).process?.parentPort;`,
         `${i1}if (!port) {`,
         `${i1}${i1}throw new TypeError('These bindings can be used only in an Electron utility process, which has process.parentPort');`,
         `${i1}}`,
         `${i1}const peer = createUtilityPeer((message) => port.postMessage(message));`,
         ...receive,
         `${i1}utilityPeer = peer;`,
         `${i1}return peer;`,
         "}",
         "",
      ].join("\n");
   }
   /** The wire names of the channels between a page and the child, and their kinds. */
   private getBrokeredSpecs(): t.ChannelSpec[] {
      return this.pfsArray.flatMap((pfs) =>
         pfs.specs.channelSpecArray.filter((spec) => isBrokeredSpec(spec)),
      );
   }
   private buildBrokerServer(brokered: t.ChannelSpec[]): string {
      const channels = brokered
         .map((spec) => this.wireName(spec.name))
         .sort(utils.compareStrings)
         .join(", ");
      const windows = brokered
         .filter((spec) => spec.kind === "Stream")
         .map((spec) => [this.wireName(spec.name), this.getHighWaterMark(spec)] as const)
         .sort(([a], [b]) => utils.compareStrings(a, b))
         .map(([wire, mark]) => `[${wire}, ${mark}]`)
         .join(", ");
      return buildBrokerServer(this.indents, this.usesSerializer(), channels, windows);
   }
   private buildBindings(channels: ChannelEntry[]): string {
      const [i0] = this.indents;
      const out = ["export const ipc = {"];
      for (const channel of this.sortChannels(channels)) {
         out.push(`\n${i0}${channel.name}: {`, ...channel.members, `\n${i0}},`);
      }
      out.push("\n}\n");
      return out.join("");
   }
   /**
    * `handle(callback)` of a `callUtility` channel, `on(callback)` and `once(callback)` of a
    * `notifyUtility` channel, `invoke(...args)` of a `callMain` channel and `send(...args)` of a
    * `notifyMain` channel. A handler replaces the previous one, and the function that `handle`
    * returns removes only its own. The `handle(callback)` of an `invokeUtility` or `streamUtility`
    * channel serves the page over the port that the main process brokers.
    */
   private buildChannel(spec: t.ChannelSpec): ChannelEntry {
      const [, i1, i2] = this.indents;
      const taken = collectIdentifiers([spec.signature.definition]);
      const callbackName = uniqueName("callback", taken);
      const wire = this.wireName(spec.name);
      const typeParams = this.getTypeParams(spec.signature);
      const params = this.getOriginalParams(spec, false);
      const senderParams = this.getOriginalParams(spec, true);
      const rest = senderParams ? `[${senderParams}]` : "[]";
      const callback = `${callbackName}: ${spec.signature.definition}`;
      if (spec.direction === "RendererToUtility") {
         // A page calls the handler, or reads the stream of the handler, over a brokered port.
         const register = spec.kind === "Stream" ? "setBrokerStream" : "setBrokerCall";
         return {
            name: spec.name,
            members: [
               `\n${i1}handle: (${callback}) =>`,
               `\n${i2}${register}(${wire}, ${callbackName}),`,
            ],
         };
      }
      if (spec.direction === "UtilityToMain") {
         if (spec.kind === "Broadcast") {
            return {
               name: spec.name,
               members: [
                  `\n${i1}send: ${typeParams}(${params}): void =>`,
                  `\n${i2}sendUtilityPeer(getUtilityPeer(), ${wire}, ${rest}),`,
               ],
            };
         }
         const returned = spec.signature.async
            ? spec.signature.returnType
            : `Promise<Awaited<${spec.signature.returnType}>>`;
         return {
            name: spec.name,
            members: [
               `\n${i1}invoke: ${typeParams}(${params}): ${returned} =>`,
               `\n${i2}callUtilityPeer(getUtilityPeer(), ${wire}, ${rest}${this.getTimeoutArgument(spec)}) as ${returned},`,
            ],
         };
      }
      if (spec.kind === "Broadcast") {
         return {
            name: spec.name,
            members: [
               `\n${i1}on: (${callback}) =>`,
               `\n${i2}addUtilityListener(getUtilityPeer(), ${wire}, ${callbackName}, false),`,
               `\n${i1}once: (${callback}) =>`,
               `\n${i2}addUtilityListener(getUtilityPeer(), ${wire}, ${callbackName}, true),`,
            ],
         };
      }
      return {
         name: spec.name,
         members: [
            `\n${i1}handle: (${callback}) =>`,
            `\n${i2}setUtilityHandler(getUtilityPeer(), ${wire}, ${callbackName}),`,
         ],
      };
   }
}
