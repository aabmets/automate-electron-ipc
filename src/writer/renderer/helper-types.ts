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

import utils from "../../utils.js";
import { renderTypes } from "./renderer-declaration.js";
import { type CollectedChannels, RendererTypesWriter } from "./renderer-types.js";

/** The import of the type of the channel definitions, which the helper types take apart. */
const CHANNEL_DEF_IMPORT = 'import type { ChannelDef } from "automate-electron-ipc";';

/**
 * Writes `types.ts`, the types of the API of the page for code that cannot use the global of
 * `window.d.ts`: the `IpcApi` interface and the types it refers to, and the helper types
 * `ChannelName`, `ChannelArgs<N>` and `ChannelReturn<N>`, which read the signatures from the
 * channel maps of the schema files. The file declares no global, so a file of the main process
 * can import it without getting a variable of the page.
 */
export class HelperTypesWriter extends RendererTypesWriter {
   protected getTargetFilePath(): string {
      return this.getTypesFilePath();
   }
   protected getReservedNames(): string[] {
      return [
         ...super.getReservedNames(),
         "ChannelName",
         "ChannelArgs",
         "ChannelReturn",
         "ChannelDef",
         "SignatureOf",
         "ChunkOf",
         "ChannelMaps",
         "ReturnType",
         "AsyncIterable",
      ];
   }
   protected renderModule({ channels, imports, files }: CollectedChannels): string {
      const maps = files.flatMap(({ pfs, names }) => {
         const map = this.importsGenerator.getChannelMapImport(pfs);
         return map ? [{ ...map, names }] : [];
      });
      const lines = [
         ...imports,
         ...(maps.length > 0 ? [CHANNEL_DEF_IMPORT] : []),
         ...maps.flatMap((map) => (map.declaration ? [map.declaration] : [])),
      ].sort(utils.compareStrings);
      const types = renderTypes(channels, this.getDeclarationOptions(), true);
      const names = maps.flatMap((map) => map.names);
      const helpers = this.renderHelperTypes(
         maps.map((map) => map.local),
         names,
      );
      return `${[...lines, types, helpers].join("\n")}\n`;
   }
   /**
    * `ChannelName` is the union of the names of the channels of the page, and the other two types
    * read the signature of a channel from the type of the exported channel map of its schema file,
    * which is the signature itself for the `as` form and a `ChannelDef` for the generic form.
    */
   private renderHelperTypes(mapNames: string[], channelNames: string[]): string {
      const i0 = this.indents[0];
      const union =
         channelNames.length > 0
            ? this.sortChannels(channelNames.map((name) => ({ name })))
                 .map((channel) => `'${channel.name}'`)
                 .join(" | ")
            : "never";
      const name = [
         "\n/** The name of a channel of the API. */",
         `export type ChannelName = ${union};`,
      ];
      if (channelNames.length === 0) {
         return [
            ...name,
            "\n/** The parameters of a channel. */",
            "export type ChannelArgs<N extends ChannelName> = N extends ChannelName ? never : never;",
            "\n/** The result of a call of a channel. */",
            "export type ChannelReturn<N extends ChannelName> = N extends ChannelName ? never : never;",
         ].join("\n");
      }
      return [
         ...name,
         `\ntype ChannelMaps = ${mapNames.map((local) => `typeof ${local}`).join(" & ")};`,
         "\ntype SignatureOf<T> = T extends ChannelDef<infer S extends (...args: any[]) => any, any>",
         `${i0}? S`,
         `${i0}: T extends (...args: any[]) => any`,
         `${i0}? T`,
         `${i0}: never;`,
         "\ntype ChunkOf<R> = R extends AsyncIterable<infer C> ? C : R;",
         "\n/** The parameters of a channel, as a tuple. */",
         "export type ChannelArgs<N extends ChannelName> = Parameters<SignatureOf<ChannelMaps[N]>>;",
         "\n/**",
         " * What a call of a channel gives: the result of the handler, with its promise resolved, or the",
         " * type of the chunks for a stream.",
         " */",
         "export type ChannelReturn<N extends ChannelName> =",
         `${i0}ChunkOf<Awaited<ReturnType<SignatureOf<ChannelMaps[N]>>>>;`,
      ].join("\n");
   }
}
