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
import type { MainContext } from "./main-bindings.js";

/** The listeners and handlers of the channels from a renderer to the main process. */

/** The names that a generated listener uses, which differ from the names of its signature. */
export interface ListenerNames {
   event: string;
   callback: string;
   listener: string;
   remove: string;
   eventType: string;
   /** The channel name as a quoted literal. */
   channel: string;
   isBroadcast: boolean;
   /** The local name of the imported validator. */
   validator: string;
   received: string;
   args: string;
   call: string;
   spent: string;
   /** The name of the decoded arguments of a serialized channel. */
   decoded: string;
   /** Whether the arguments arrive through the serializer. */
   serialized: boolean;
}

/**
 * The listener that is registered with Electron, around the one that runs the handler. A
 * stream is started by the call, whose first argument is the ID that the page gave it. The
 * envelope settles the call, and a serialized result is encoded in the thunk that settles it.
 * Without the envelope, only a serialized result needs a wrapper.
 */
export function buildOuterListener(
   ctx: MainContext,
   spec: t.ChannelSpec,
   n: ListenerNames,
   inner: string[],
   w: {
      innerName: string;
      argsName: string;
      idName: string;
      envelope: boolean;
      encodesResult: boolean;
   },
): string[] {
   const [, , i2, i3] = ctx.indents;
   const run = `(${w.innerName} as (...${w.argsName}: unknown[]) => unknown)(${n.event}, ...${w.argsName})`;
   const result = w.encodesResult ? `encodeValue(${n.channel}, await ${run})` : run;
   const params = `${n.event}: ${n.eventType}, ...${w.argsName}: unknown[]`;
   if (spec.kind === "Stream") {
      const start = `startStream(${n.event}, ${n.channel}, ${ctx.wireName(spec.name)}, ${w.idName}, ${ctx.getHighWaterMark(spec)}, () => ${run})`;
      return [
         ...inner,
         `${i2}const ${n.listener} = (${n.event}: ${n.eventType}, ${w.idName}: unknown, ...${w.argsName}: unknown[]) =>`,
         `${i3}settleInvoke(() => ${start});`,
      ];
   }
   if (w.envelope) {
      const settle = w.encodesResult ? `async () => ${result}` : `() => ${run}`;
      return [
         ...inner,
         `${i2}const ${n.listener} = (${params}) =>`,
         `${i3}settleInvoke(${settle});`,
      ];
   }
   return w.encodesResult
      ? [...inner, `${i2}const ${n.listener} = async (${params}) =>`, `${i3}${result};`]
      : inner;
}

/**
 * The lines that decode the arguments of a serialized channel, after the sender check: a call
 * that is answered throws, and a message that is not answered is logged and dropped.
 */
function buildDecodeLines(indents: string[], n: ListenerNames): string[] {
   if (!n.serialized) {
      return [];
   }
   const [, , , i3, i4] = indents;
   return n.isBroadcast
      ? [
           `${i3}const ${n.decoded} = readSentArguments(${n.channel}, ${n.received});`,
           `${i3}if (!${n.decoded}) {`,
           `${i4}return;`,
           `${i3}}`,
        ]
      : [`${i3}const ${n.decoded} = readArguments(${n.channel}, ${n.received});`];
}

/**
 * The listener of a serialized channel without a validator. It takes the arguments as they
 * arrived, and calls the callback with the ones that the serializer returns, so it does not
 * declare the parameters of the signature. `check` is the sender check. A `once` listener is
 * used up by the first message that could be read.
 */
export function buildDecodedListener(
   indents: string[],
   n: ListenerNames,
   check: string[],
   once: boolean,
): string[] {
   const [, , i2, i3] = indents;
   return [
      `${i2}const ${n.call} = ${n.callback} as (${n.event}: ${n.eventType}, ...${n.args}: unknown[]) => unknown;`,
      `${i2}const ${n.listener} = (${n.event}: ${n.eventType}, ...${n.received}: unknown[]) => {`,
      ...check,
      ...buildDecodeLines(indents, n),
      ...(once ? [`${i3}${n.remove}();`] : []),
      `${i3}return ${n.call}(${n.event}, ...${n.decoded});`,
      `${i2}};`,
   ];
}

/**
 * The listener of a channel with a validator. It takes the arguments as they arrived, so the
 * schema sees all of them, and the callback gets the output of the schema, so the listener
 * does not declare the parameters of the signature. `check` is the sender check.
 * A `once` listener is used up by the first valid call only. A second call may pass an
 * asynchronous schema before the first is accepted, and only one of them gets the callback.
 */
export function buildValidatedListener(
   indents: string[],
   n: ListenerNames,
   check: string[],
   once: boolean,
): string[] {
   const [, , i2, i3, i4, i5] = indents;
   const spentBranch = n.isBroadcast
      ? `${i5}return;`
      : `${i5}throw new Error("No handler registered for ${n.channel}");`;
   return [
      `${i2}const ${n.call} = ${n.callback} as (${n.event}: ${n.eventType}, ...${n.args}: unknown[]) => unknown;`,
      ...(once ? [`${i2}let ${n.spent} = false;`] : []),
      `${i2}const ${n.listener} = (${n.event}: ${n.eventType}, ...${n.received}: unknown[]) => {`,
      ...check,
      ...buildDecodeLines(indents, n),
      `${i3}return validateArguments(${n.event}, ${n.channel}, ${n.validator}, ${n.serialized ? n.decoded : n.received}, ${n.isBroadcast}, (${n.args}) => {`,
      ...(once
         ? [
              `${i4}if (${n.spent}) {`,
              spentBranch,
              `${i4}}`,
              `${i4}${n.spent} = true;`,
              `${i4}${n.remove}();`,
           ]
         : []),
      `${i4}return ${n.call}(${n.event}, ...${n.args});`,
      `${i3}});`,
      `${i2}};`,
   ];
}
