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

declare const channelDef: unique symbol;
declare const channelErrors: unique symbol;

/**
 * Any function type. Signatures of channels must be function types.
 */
export type ChannelSignature = (...args: any[]) => any;

/**
 * Branded value returned by the verb helpers when a signature type argument is given.
 * It carries the signature, and the error types of an `invoke` channel, at the type level
 * only, nothing exists at runtime.
 */
export interface ChannelDef<S extends ChannelSignature = ChannelSignature, E = never> {
   readonly [channelDef]: S;
   readonly [channelErrors]?: E;
}

/**
 * The type returned by verb helpers: a `ChannelDef<S>` when the signature `S` is given
 * as a type argument, otherwise `unknown`, so that `verb(config) as Signature` type-checks.
 */
export type ChannelResult<S extends ChannelSignature, E = never> = [S] extends [never]
   ? unknown
   : ChannelDef<S, E>;

/**
 * The Standard Schema interface (https://standardschema.dev), which zod, valibot, arktype and
 * other libraries implement. It is copied here so that this package needs no dependency.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
   readonly "~standard": StandardSchemaV1Props<Input, Output>;
}

export interface StandardSchemaV1Props<Input = unknown, Output = Input> {
   readonly version: 1;
   readonly vendor: string;
   readonly validate: (
      value: unknown,
   ) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
   readonly types?: { readonly input: Input; readonly output: Output } | undefined;
}

export type StandardSchemaV1Result<Output> =
   | { readonly value: Output; readonly issues?: undefined }
   | { readonly issues: readonly StandardSchemaV1Issue[] };

export interface StandardSchemaV1Issue {
   readonly message: string;
   readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
}

/**
 * The schema of the arguments of a channel, as a Standard Schema of the tuple `Parameters<S>`.
 * Input is not constrained, since the arguments come from an untrusted renderer. In the
 * `verb(config) as Signature` form, which does not check the config against the signature,
 * any Standard Schema is accepted.
 */
export type ArgumentsSchema<S extends ChannelSignature> = [S] extends [never]
   ? StandardSchemaV1
   : StandardSchemaV1<unknown, Parameters<S>>;
