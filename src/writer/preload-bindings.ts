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
   buildAskChannel,
   buildAskComponents,
   buildAskListener,
   buildErrorComponents,
} from "./preload-asks.js";
import {
   buildRendererToMainChannel,
   buildSerializerComponents,
   getTimeoutComponents,
} from "./preload-invoke.js";
import { buildPortComponents, buildPortInitializer } from "./preload-ports.js";
import {
   buildStreamChannel,
   buildStreamComponents,
   buildStreamListener,
   buildStreamReader,
   hasBrokeredStreams,
} from "./preload-streams.js";
import { buildSubscriptionChannel, buildSubscriptionComponents } from "./preload-subscriptions.js";
import { buildBrokeredChannel, buildUtilityClient } from "./preload-utility.js";

export interface ChannelEntry {
   name: string;
   /** The property of the exposed object, starting with a newline. */
   property: string;
}

/** The channels of the page, by the components that they need. */
export interface ChannelGroups {
   portSpecs: t.ChannelSpec[];
   askNames: string[];
   streamSpecs: t.ChannelSpec[];
   brokeredSpecs: t.ChannelSpec[];
   /** Whether a channel has `on` and `once`, which share `subscribe`. */
   subscribed: boolean;
   channels: ChannelEntry[];
}

/**
 * What the modules of the generated `preload.ts` read from the writer: the indents, the config,
 * and the helpers of `BaseWriter` that they call, bound to the writer. A function which reads only
 * the indents takes `indents` instead.
 */
export interface PreloadContext {
   indents: string[];
   config: t.IPCResolvedConfig;
   /** Whether the config names a serializer. */
   usesSerializer: boolean;
   wireName: (name: string, suffix?: string) => string;
   isSerializedSpec: (spec: t.ChannelSpec) => boolean;
   getHighWaterMark: (spec: t.ChannelSpec) => string;
   getMaxQueue: (spec: t.ChannelSpec) => string;
   getTimeoutMs: (spec: t.ChannelSpec) => number;
   getTimeoutArgument: (spec: t.ChannelSpec) => string;
}

/**
 * The `getPathForFile` helper of the API. `File.path` is gone since Electron 32, and the path of a
 * file that the page holds is known only to the preload script. `webUtils` is available in a
 * sandboxed preload, and contextBridge hands the `File` of the page over as it is.
 */
const PATH_FOR_FILE = "(file: File): string => webUtils.getPathForFile(file)";

export class PreloadBindingsWriter extends BaseWriter {
   private readonly ctx: PreloadContext = {
      indents: this.indents,
      config: this.config,
      usesSerializer: this.usesSerializer(),
      wireName: this.wireName.bind(this),
      isSerializedSpec: this.isSerializedSpec.bind(this),
      getHighWaterMark: this.getHighWaterMark.bind(this),
      getMaxQueue: this.getMaxQueue.bind(this),
      getTimeoutMs: this.getTimeoutMs.bind(this),
      getTimeoutArgument: this.getTimeoutArgument.bind(this),
   };
   protected getTargetFilePath(): string {
      return this.getScopedFilePath(this.config.preloadBindingsFilePath);
   }
   protected isEmpty(): boolean {
      return !this.hasRendererChannels();
   }
   /**
    * The page takes no part in the traffic between the main process and a utility process, or a
    * service worker. The worker script has its channels mapped to those of a page first.
    */
   protected isSerializedSpec(spec: t.ChannelSpec): boolean {
      return !(this.isUtilitySpec(spec) || this.isWorkerSpec(spec)) && super.isSerializedSpec(spec);
   }
   protected renderEmptyFileContents(): string {
      const [i0] = this.indents;
      const bridge = this.getPathForFileEnabled() ? "contextBridge, webUtils" : "contextBridge";
      const api = this.getPathForFileEnabled()
         ? `export const api = {\n${i0}getPathForFile: ${PATH_FOR_FILE},\n};`
         : "export const api = {};";
      return [`import { ${bridge} } from "electron";\n`, api, ""]
         .concat(this.buildExpose())
         .join("\n");
   }
   protected renderFileContents(): string {
      const groups = this.groupChannels();
      const out = this.buildComponents(groups);
      if (this.getPathForFileEnabled()) {
         groups.channels.push({
            name: "getPathForFile",
            property: `\n${this.indents[0]}getPathForFile: ${PATH_FOR_FILE},`,
         });
      }
      const bindingsExpression = ["\nexport const api = {"];
      for (const channel of this.sortChannels(groups.channels)) {
         bindingsExpression.push(channel.property);
      }
      bindingsExpression.push("\n};\n");

      out.push(bindingsExpression.join(""), ...this.buildExpose(), "");
      return this.joinComponents(out);
   }

   /**
    * `expose(key)`, which exposes `api` under the key: in the main world by default, or in the
    * isolated world of the config. The key defaults to `exposeAs`. The call of `expose()` that
    * follows is left out when `autoExpose` is off, so that the app's own preload code can decide
    * when and under which keys to expose the API.
    */
   private buildExpose(): string[] {
      const [i1] = this.indents;
      const worldId = this.getWorldId();
      const call =
         worldId === undefined
            ? "contextBridge.exposeInMainWorld(key, api);"
            : `contextBridge.exposeInIsolatedWorld(${worldId}, key, api);`;
      const out = [
         `export function expose(key = '${this.getExposeAs()}'): void {`,
         `${i1}${call}`,
         "}",
      ];
      if (this.getAutoExpose()) {
         out.push("", "expose();");
      }
      return out;
   }

   /** The isolated world that the API is exposed in, or `undefined` for the main world. */
   protected getWorldId(): number | undefined {
      return this.config.isolatedWorldId;
   }

   /** Sorts the channels of the page into the groups that need components of their own. */
   protected groupChannels(): ChannelGroups {
      const groups: ChannelGroups = {
         portSpecs: [],
         askNames: [],
         streamSpecs: [],
         brokeredSpecs: [],
         subscribed: false,
         channels: [],
      };
      for (const parsedFileSpecs of this.pfsArray) {
         for (const spec of this.getRendererSpecs(parsedFileSpecs)) {
            this.groupChannel(spec, groups);
         }
      }
      return groups;
   }

   protected groupChannel(spec: t.ChannelSpec, groups: ChannelGroups): void {
      const { portSpecs, askNames, streamSpecs, brokeredSpecs, channels } = groups;
      if (spec.kind === "Port") {
         // The page has the same API for both peers: another page, or the main process.
         portSpecs.push(spec);
         channels.push({
            name: spec.name,
            property: `\n${this.indents[0]}${spec.name}: ports['${spec.name}'].api,`,
         });
      } else if (this.isBrokeredSpec(spec)) {
         brokeredSpecs.push(spec);
         channels.push(buildBrokeredChannel(this.ctx, spec));
      } else if (spec.kind === "Stream") {
         streamSpecs.push(spec);
         channels.push(buildStreamChannel(this.ctx, spec));
      } else if (spec.direction === "RendererToMain") {
         channels.push(buildRendererToMainChannel(this.ctx, spec));
      } else if (spec.direction === "MainToRenderer") {
         if (spec.kind === "Unicast") {
            askNames.push(spec.name);
            channels.push(buildAskChannel(this.indents, spec));
         } else {
            groups.subscribed = true;
            channels.push(buildSubscriptionChannel(this.ctx, spec));
         }
      }
   }

   /** The code above the exposed object: the imports, and the components that the channels use. */
   private buildComponents(groups: ChannelGroups): string[] {
      const { portSpecs, askNames, streamSpecs, brokeredSpecs } = groups;
      const imports = this.getPathForFileEnabled()
         ? "contextBridge, ipcRenderer, webUtils"
         : "contextBridge, ipcRenderer";
      const out: string[] = [`import { ${imports} } from "electron";`];
      if (this.hasSerializedChannels()) {
         out.push(this.buildSerializerImport());
      }
      if (portSpecs.length > 0) {
         out.push(
            'import type { IpcRendererEvent } from "electron";',
            buildPortComponents(this.ctx),
            ...portSpecs
               .sort((a, b) => utils.compareStrings(a.name, b.name))
               .map((spec) => buildPortInitializer(this.ctx, spec)),
         );
      }
      if (this.hasSerializedChannels()) {
         out.push(buildSerializerComponents(this.indents));
      }
      if (groups.subscribed) {
         out.push(buildSubscriptionComponents(this.indents));
      }
      out.push(...getTimeoutComponents(this.ctx, this.pfsArray));
      if (askNames.length > 0 || streamSpecs.length > 0 || brokeredSpecs.length > 0) {
         out.push(buildErrorComponents(this.indents));
      }
      if (streamSpecs.length > 0 || hasBrokeredStreams(brokeredSpecs)) {
         out.push(buildStreamReader(this.indents));
      }
      if (askNames.length > 0) {
         out.push(
            buildAskComponents(this.ctx),
            ...askNames
               .sort(utils.compareStrings)
               .map((askName) => buildAskListener(this.ctx, askName)),
         );
      }
      if (streamSpecs.length > 0) {
         out.push(
            buildStreamComponents(this.ctx),
            ...streamSpecs
               .sort((a, b) => utils.compareStrings(a.name, b.name))
               .map((spec) => buildStreamListener(this.ctx, spec.name)),
            "",
         );
      }
      if (brokeredSpecs.length > 0) {
         out.push(...buildUtilityClient(this.ctx, brokeredSpecs));
      }
      return out;
   }
}
