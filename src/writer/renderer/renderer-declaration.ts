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

import type { Scope } from "../../scopes.js";
import utils from "../../utils.js";

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

/** What the declaration of the types needs from the writer that renders it. */
export interface TypesOptions {
   indents: string[];
   /** The name that the API is exposed as. */
   exposeAs: string;
   /** Whether the API has the `getPathForFile` helper. */
   pathForFile: boolean;
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
 * The declarations of the error types, one text each, for the ones that a channel can fail with.
 * `nested` indents them one level, for the block of `declare global`, and leaves out `export`,
 * which the types module puts in front of each.
 */
function renderErrorTypes(
   channels: ChannelEntry[],
   { indents, exposeAs }: TypesOptions,
   nested: boolean,
): string[] {
   const [i0, i1, i2] = indents;
   const [base, l1, l2] = nested ? [i0, i1, i2] : ["", i0, i1];
   const exported = nested ? "" : "export ";
   const errorType = channels.some((channel) => channel.throws)
      ? [
           `${base}/**`,
           `${base} * The object that the promise of \`${exposeAs}.<name>.invoke\` is rejected with when the handler`,
           `${base} * throws, and that a read of \`${exposeAs}.<name>.stream\` is rejected with when the stream fails.`,
           `${base} * It is a plain object, since contextBridge does not keep the fields of an \`Error\`.`,
           `${base} */`,
           `${base}${exported}type IpcError<E extends Error = Error> = E extends unknown`,
           `${l1}? { name: E['name']; message: string } & (E extends { code: infer C extends string | number }`,
           `${l2}? { code: C }`,
           `${l2}: { code?: string | number }) & (E extends { data: infer D }`,
           `${l2}? { data: D }`,
           `${l2}: { data?: unknown })`,
           `${l1}: never;`,
        ].join("\n")
      : "";
   const timeoutType = channels.some((channel) => channel.times)
      ? [
           `${base}/** The error that the promise of an \`invoke\` is rejected with after its \`timeoutMs\`. */`,
           `${base}${exported}type IpcTimeoutError = Error & { name: 'IpcTimeoutError'; code: 'IPC_TIMEOUT' };`,
        ].join("\n")
      : "";
   const utilityType = channels.some((channel) => channel.utility)
      ? [
           `${base}/** The error that the library rejects a call to a utility process with, apart from the errors of the handler. */`,
           `${base}${exported}type IpcUtilityError = Error & {`,
           `${l1}name: 'IpcUtilityError';`,
           `${l1}code: 'IPC_UTILITY_EXITED' | 'IPC_UTILITY_UNSENDABLE' | 'IPC_UTILITY_INVALID_REPLY' | 'IPC_UTILITY_NO_HANDLER' | 'IPC_UTILITY_NOT_ITERABLE' | 'IPC_UTILITY_TIMEOUT';`,
           `${base}};`,
        ].join("\n")
      : "";
   return [errorType, timeoutType, utilityType].filter(Boolean);
}

/**
 * The types of the API: `IpcApi` with a member for each channel, and the types that the members
 * refer to, which are declared only if a channel uses them. With `exported`, they are the exports
 * of a module, errors included, so that code outside the page can use them. Without, the module
 * keeps them to itself, and the errors are declared by `renderGlobals`.
 */
export function renderTypes(
   channels: ChannelEntry[],
   options: TypesOptions,
   exported: boolean,
): string {
   const { indents, pathForFile } = options;
   const i0 = indents[0];
   const out = exported ? "export " : "";
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
   // The stream type is declared only if a stream channel uses it.
   const streamType = channels.some((channel) => channel.streams)
      ? [
           `\n${out}interface IpcStream<T> {`,
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
   // The types of the overflow callbacks, declared only if a port channel has them.
   const overflowTypes = channels.some((channel) => channel.overflows)
      ? [
           `\n${out}interface IpcPortOverflowInfo {`,
           `${i0}channel: string;`,
           `${i0}max: number;`,
           `${i0}dropped: number;`,
           `${i0}warnings: number;`,
           "}",
           `\n${out}type IpcPortOverflowAction = 'dropOldest' | 'dropNewest' | 'clear';`,
        ]
      : [];
   return [
      ...overflowTypes,
      ...streamType,
      `\n${out}interface IpcApi {${body}}`,
      ...(exported ? renderErrorTypes(channels, options, false).map((type) => `\n${type}`) : []),
   ].join("\n");
}

/** The lines inside `declare global`: the variable of the API, and the notes on it. */
function renderGlobals({ indents, exposeAs, worldId, scope }: DeclarationOptions): string[] {
   const i0 = indents[0];
   return [
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
   ];
}

/**
 * The API is declared as a global variable, which types the bare name, `window.<name>` and
 * `globalThis.<name>` alike. The name is `exposeAs` of the config, `ipc` by default. The type of
 * the variable and the error types come from the types module at `typesImportPath`, which also
 * serves code that is not a page. The import makes the file a module, which `declare global`
 * requires.
 */
export function renderDeclaration(
   channels: ChannelEntry[],
   options: DeclarationOptions,
   typesImportPath: string,
): string {
   const i0 = options.indents[0];
   const specifier = JSON.stringify(typesImportPath);
   const from = (name: string) => `import(${specifier}).${name}`;
   const globals = [
      ...renderGlobals(options),
      ...(channels.some((channel) => channel.throws)
         ? [
              `${i0}/** The object that a rejected call of the API carries. See the types module. */`,
              `${i0}type IpcError<E extends Error = Error> = ${from("IpcError")}<E>;`,
           ]
         : []),
      ...(channels.some((channel) => channel.times)
         ? [`${i0}type IpcTimeoutError = ${from("IpcTimeoutError")};`]
         : []),
      ...(channels.some((channel) => channel.utility)
         ? [`${i0}type IpcUtilityError = ${from("IpcUtilityError")};`]
         : []),
   ];
   return [
      `import type { IpcApi } from ${specifier};`,
      `\ndeclare global {\n${globals.join("\n")}\n}\n`,
   ].join("\n");
}

/**
 * The declaration of a file that holds the types and the global together, as the typings of a
 * service worker do: nothing is exported, and the error types are declared as globals.
 */
export function renderStandaloneDeclaration(
   channels: ChannelEntry[],
   options: DeclarationOptions,
): string {
   const globals = [...renderGlobals(options), ...renderErrorTypes(channels, options, true)];
   return [
      renderTypes(channels, options, false),
      `\ndeclare global {\n${globals.join("\n")}\n}`,
      "\nexport {};\n",
   ].join("\n");
}
