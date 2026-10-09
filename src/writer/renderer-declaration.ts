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

import type { Scope } from "../scopes.js";
import utils from "../utils.js";

export interface ChannelEntry {
   name: string;
   /** Whether the promise of the channel can be rejected with an `IpcError`. */
   throws?: boolean;
   /** Whether the channel has an overflow callback, which uses the types of the overflow. */
   overflows?: boolean;
   /** Whether the promise of the channel can be rejected with an `IpcTimeoutError`. */
   times?: boolean;
   /** Whether the channel returns an `IpcStream`. */
   streams?: boolean;
   /** Whether the promise of the channel can be rejected with an `IpcUtilityError`. */
   utility?: boolean;
   /** The methods of the channel, one per line, starting with a newline. */
   methods: string[];
}

/** What the declaration of the global needs from the writer that renders it. */
export interface DeclarationOptions {
   indents: string[];
   /** The name that the API is exposed as. */
   exposeAs: string;
   /** The isolated world that the API is exposed in, or `undefined` for the main world. */
   worldId: number | undefined;
   /** The scope that the file is written for, or `null` for the surface of no scope. */
   scope: Scope;
   /** Whether the API has the `getPathForFile` helper. */
   pathForFile: boolean;
}

function sortChannels<T extends { name: string }>(channels: T[]): T[] {
   return channels.sort((a, b) => utils.compareStrings(a.name, b.name));
}

/**
 * The API is declared as a global variable, which types the bare name, `window.<name>` and
 * `globalThis.<name>` alike. The name is `exposeAs` of the config, `ipc` by default. The empty export makes the file a module, which `declare global`
 * requires.
 */
export function renderDeclaration(
   channels: ChannelEntry[],
   { indents, exposeAs, worldId, scope, pathForFile }: DeclarationOptions,
): string {
   const i0 = indents[0];
   const [, i1, i2] = indents;
   const members = sortChannels([
      ...channels.map((channel) => ({
         name: channel.name,
         lines: [`\n${i0}${channel.name}: {`, ...channel.methods, `\n${i0}};`],
      })),
      ...(pathForFile
         ? [
              {
                 name: "getPathForFile",
                 lines: [
                    `\n${i0}/** The path of a file that the user dropped or picked. It is empty for a file that is not on the disk. */`,
                    `\n${i0}getPathForFile: (file: File) => string;`,
                 ],
              },
           ]
         : []),
   ]).flatMap((member) => member.lines);
   const body = members.length > 0 ? `${members.join("")}\n` : "";
   // The error type is declared only if a rejected invoke can carry one.
   const errorType = channels.some((channel) => channel.throws)
      ? [
           `${i0}/**`,
           `${i0} * The object that the promise of \`${exposeAs}.<name>.invoke\` is rejected with when the handler`,
           `${i0} * throws, and that a read of \`${exposeAs}.<name>.stream\` is rejected with when the stream fails.`,
           `${i0} * It is a plain object, since contextBridge does not keep the fields of an \`Error\`.`,
           `${i0} */`,
           `${i0}type IpcError<E extends Error = Error> = E extends unknown`,
           `${i1}? { name: E['name']; message: string } & (E extends { code: infer C extends string | number }`,
           `${i2}? { code: C }`,
           `${i2}: { code?: string | number }) & (E extends { data: infer D }`,
           `${i2}? { data: D }`,
           `${i2}: { data?: unknown })`,
           `${i1}: never;`,
        ].join("\n")
      : "";
   // The stream type is declared only if a stream channel uses it.
   const streamType = channels.some((channel) => channel.streams)
      ? [
           `\ninterface IpcStream<T> {`,
           `${i0}/** The next chunk. The promise is rejected with the error of the stream, if it fails. */`,
           `${i0}next(): Promise<IteratorResult<T, undefined>>;`,
           `${i0}/** Stops the stream and the generator of its handler. */`,
           `${i0}return(): Promise<IteratorResult<T, undefined>>;`,
           `${i0}/** Stops the stream and the generator of its handler, like \`return()\` does. */`,
           `${i0}cancel(): void;`,
           `${i0}[Symbol.asyncIterator](): IpcStream<T>;`,
           "}",
        ]
      : [];
   // The timeout error is declared only if a channel can time out.
   const timeoutType = channels.some((channel) => channel.times)
      ? [
           `${i0}/** The error that the promise of an \`invoke\` is rejected with after its \`timeoutMs\`. */`,
           `${i0}type IpcTimeoutError = Error & { name: 'IpcTimeoutError'; code: 'IPC_TIMEOUT' };`,
        ].join("\n")
      : "";
   // The error of the utility process is declared only if a channel to one can fail with it.
   const utilityType = channels.some((channel) => channel.utility)
      ? [
           `${i0}/** The error that the library rejects a call to a utility process with, apart from the errors of the handler. */`,
           `${i0}type IpcUtilityError = Error & {`,
           `${i1}name: 'IpcUtilityError';`,
           `${i1}code: 'IPC_UTILITY_EXITED' | 'IPC_UTILITY_UNSENDABLE' | 'IPC_UTILITY_INVALID_REPLY' | 'IPC_UTILITY_NO_HANDLER' | 'IPC_UTILITY_NOT_ITERABLE' | 'IPC_UTILITY_TIMEOUT';`,
           `${i0}};`,
        ].join("\n")
      : "";
   const globals = [
      ...(scope === null
         ? []
         : [
              `${i0}/**`,
              `${i0} * The API of the scope '${scope}': its own channels and the ones that have no scope.`,
              `${i0} * Every window.*.d.ts declares this variable, so a project includes only one of them.`,
              `${i0} */`,
           ]),
      ...(worldId === undefined
         ? []
         : [
              `${i0}/** Exposed in the isolated world ${worldId}, so only scripts of that world can use it. */`,
           ]),
      `${i0}var ${exposeAs}: IpcApi;`,
      ...(errorType ? [errorType] : []),
      ...(timeoutType ? [timeoutType] : []),
      ...(utilityType ? [utilityType] : []),
   ];
   // The types of the overflow callbacks, declared only if a port channel has them.
   const overflowTypes = channels.some((channel) => channel.overflows)
      ? [
           `\ninterface IpcPortOverflowInfo {`,
           `${i0}channel: string;`,
           `${i0}max: number;`,
           `${i0}dropped: number;`,
           `${i0}warnings: number;`,
           "}",
           `\ntype IpcPortOverflowAction = 'dropOldest' | 'dropNewest' | 'clear';`,
        ]
      : [];
   return [
      ...overflowTypes,
      ...streamType,
      `\ninterface IpcApi {${body}}`,
      `\ndeclare global {\n${globals.join("\n")}\n}`,
      "\nexport {};\n",
   ].join("\n");
}
