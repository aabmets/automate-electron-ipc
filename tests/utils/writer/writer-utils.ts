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

import { parseModule } from "@src/parser/ast.js";
import { parseSignature } from "@src/parser/type/signature.js";
import type * as t from "@types";

/** The channels that many writer tests describe, so that they need not write them out. */
export const getIt = { name: "getIt", kind: "Unicast", direction: "RendererToMain" } as const;
export const sendIt = { name: "sendIt", kind: "Broadcast", direction: "RendererToMain" } as const;
export const getUser = { name: "getUser", kind: "Unicast", direction: "RendererToMain" } as const;

/**
 * Builds the file specs of one channel, with a signature that the parser produces from
 * `(arg1: T, arg2: T) => R`, where the second parameter may be rest or optional.
 */
function getParsedFileSpecsArray(vcs: t.VitestChannelSpec): t.ParsedFileSpecs[] {
   let second = "arg2";
   if (vcs.paramRest) {
      second = "...arg2";
   } else if (vcs.paramOptional) {
      second = "arg2?";
   }
   const secondType = vcs.paramRest ? `${vcs.paramType}[]` : vcs.paramType;
   const definition = `(arg1: ${vcs.paramType}, ${second}: ${secondType}) => ${vcs.sigReturnType}`;
   const channelSpec: t.ChannelSpec = {
      name: "vitestChannel",
      kind: vcs.channelKind as t.ChannelKind,
      direction: vcs.channelDirection as t.ChannelDirection,
      signature: parseTestSignature(definition),
   };
   return [
      {
         fullPath: "/project/ipc/schema.ts",
         relativePath: "schema.ts",
         specs: {
            typeSpecArray: [],
            importSpecArray: [],
            channelSpecArray: [channelSpec],
            channelMapExport: { kind: "default" },
         },
      },
   ];
}

/** Parses a signature text the same way the parser does for real schema files. */
export function parseTestSignature(
   definition: string,
   locals: string[] = [],
   streaming = false,
): t.CallableSignature {
   const { module, src } = parseModule(`type T = ${definition};`);
   const alias = (module.body[0] as any).typeAnnotation;
   return parseSignature(alias, src, new Set(locals), new Map(), streaming);
}

export interface SimpleChannel {
   name: string;
   kind: t.ChannelKind;
   direction: t.ChannelDirection;
   /** Parameters as written in the signature, such as `"id: number"` or `"...rest: string[]"`. */
   params?: readonly string[];
   returnType?: string;
   trigger?: string;
   allowedOrigins?: readonly string[];
   validate?: t.ValidatorRef;
   /** The size of the send queues of a port channel. */
   maxQueue?: number;
   /** The most unread chunks of a stream channel, or `Infinity`. */
   highWaterMark?: number;
   /** The timeout of an invoke channel in milliseconds. */
   timeoutMs?: number;
   /** The error types of an invoke or stream channel, such as `"NotFoundError | AuthError"`. */
   errors?: string;
   /** The scopes of the channel. */
   scopes?: readonly string[];
}

/**
 * Builds the file specs of a schema file from simple channel descriptors,
 * parsing the signatures the same way the parser does for real schema files.
 */
export function buildFileSpecs(...channels: SimpleChannel[]): t.ParsedFileSpecs[] {
   const channelSpecArray = channels.map((channel) => {
      const definition = `(${(channel.params ?? []).join(", ")}) => ${channel.returnType ?? "void"}`;
      const { module, src } = parseModule(`type T = ${definition};`);
      const alias = (module.body[0] as any).typeAnnotation;
      const { trigger, errors, params: _params, returnType: _returnType, ...rest } = channel;
      return {
         ...rest,
         signature: parseSignature(alias, src, new Set(), new Map(), channel.kind === "Stream"),
         ...(trigger && { trigger }),
         ...(errors && { errors: { definition: errors, customTypes: [] } }),
      };
   });
   return [
      {
         fullPath: "/project/ipc/schema.ts",
         relativePath: "schema.ts",
         specs: {
            typeSpecArray: [],
            importSpecArray: [],
            channelSpecArray,
            channelMapExport: { kind: "default" },
         },
      } as unknown as t.ParsedFileSpecs,
   ];
}

/** File specs of one channel of each kind and direction, with a signature that has a rest parameter. */
export const vitestChannelSpecs = {
   Unicast_RendererToMain: getParsedFileSpecsArray({
      channelKind: "Unicast",
      channelDirection: "RendererToMain",
      paramType: "CustomType",
      paramRest: false,
      paramOptional: true,
      sigReturnType: "Promise<string>",
   }),
   Broadcast_RendererToMain: getParsedFileSpecsArray({
      channelKind: "Broadcast",
      channelDirection: "RendererToMain",
      paramType: "string",
      paramRest: false,
      paramOptional: false,
      sigReturnType: "void",
   }),
   Broadcast_MainToRenderer: getParsedFileSpecsArray({
      channelKind: "Broadcast",
      channelDirection: "MainToRenderer",
      paramType: "number",
      paramRest: true,
      paramOptional: false,
      sigReturnType: "Promise<CustomType>",
   }),
   Port_RendererToRenderer: getParsedFileSpecsArray({
      channelKind: "Port",
      channelDirection: "RendererToRenderer",
      paramType: "string",
      paramRest: false,
      paramOptional: false,
      sigReturnType: "void",
   }),
   Port_MainToRenderer: getParsedFileSpecsArray({
      channelKind: "Port",
      channelDirection: "MainToRenderer",
      paramType: "string",
      paramRest: false,
      paramOptional: false,
      sigReturnType: "void",
   }),
};
