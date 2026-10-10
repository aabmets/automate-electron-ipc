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
import { parseChannelMapModule } from "@src/parser/channel/channel-map.js";
import type * as t from "@types";

export const IMPORT =
   'import { defineChannels, invoke, send, emit, ask, stream, port, mainPort, callUtility, notifyUtility, callMain, notifyMain, invokeUtility, streamUtility, invokeFromWorker, sendFromWorker, askWorker, emitToWorker } from "automate-electron-ipc";';

export function parseMap(code: string, imports = IMPORT) {
   const { module, src } = parseModule(`${imports}\n${code}`);
   return parseChannelMapModule(module, src, "schema.ts");
}

export function parseOne(entry: string): Partial<t.ChannelSpec> {
   const { channelSpecs } = parseMap(`export default defineChannels({ ${entry} });`);
   if (channelSpecs.length !== 1) {
      throw new Error(`Expected one channel, got ${channelSpecs.length}`);
   }
   return channelSpecs[0];
}

/** The message of the error that the parser throws, with all of its text including the code frame. */
export function parseFullError(code: string, imports = IMPORT): string {
   try {
      parseMap(code, imports);
   } catch (err) {
      return (err as Error).message;
   }
   throw new Error("Expected the parser to throw");
}

/**
 * The message of the error that the parser throws, without the position and the code frame, which
 * `tests/test_parser/diagnostics/positions.test.ts` covers.
 */
export function parseError(code: string, imports = IMPORT): string {
   const message = parseFullError(code, imports).replace(
      /^(Schema file '[^']*') \(\d+:\d+\)/,
      "$1",
   );
   const frame = message.indexOf("\n\n");
   return frame < 0 ? message : message.slice(0, frame);
}
