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

import { SCHEMA_IMPORT as IMPORT, typecheck } from "@testutils/tsc-utils.js";
import { describe, expect, it } from "vitest";

describe("public types", () => {
   it("accepts the generic form and the as form", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            ${IMPORT}
            interface User { id: number }

            export default defineChannels({
               getUser: invoke<(id: number) => Promise<User>>(),
               echoUserName: send<(userName: string) => void>({}),
               progress: emit<(n: number) => void>({ trigger: "focus" }),
               chat: port<(msg: string) => void>(),
               logTail: mainPort<(line: string) => void>(),

               getUserAlt: invoke({}) as (id: number) => Promise<User>,
               progressAlt: emit({ trigger: "focus" }) as (n: number) => void,
               chatAlt: (port() as (msg: string) => void),
               logTailAlt: (mainPort() as (line: string) => void),
            });
         `,
      });
      expect(diagnostics).toBe("");
   });

   it("accepts the generic form and the as form of ask", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            ${IMPORT}
            export default defineChannels({
               hasUnsavedChanges: ask<(documentId: number) => boolean>(),
               getEditorState: ask<() => Promise<string>>({}),
               hasUnsavedChangesAlt: ask() as (documentId: number) => boolean,
            });
         `,
      });
      expect(diagnostics).toBe("");
   });

   it("accepts the generic form and the as form of stream, with its options and error types", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            ${IMPORT}
            import type { StandardSchemaV1 } from "automate-electron-ipc";
            interface Row { id: number }
            class NotFound extends Error {}
            declare const rowArgs: StandardSchemaV1<unknown, [table: string]>;

            export default defineChannels({
               rows: stream<(table: string) => AsyncIterable<Row>>(),
               rowsGen: stream<(table: string) => AsyncGenerator<Row, void, undefined>>({}),
               rowsIter: stream<() => AsyncIterableIterator<Row>, NotFound>(),
               rowsGuarded: stream<(table: string) => AsyncIterable<Row>>({
                  allowedOrigins: ["app://."],
                  validate: rowArgs,
               }),
               rowsAlt: stream({}) as (table: string) => AsyncIterable<Row>,
            });
         `,
      });
      expect(diagnostics).toBe("");
   });

   it("rejects options of other verbs and a validator for other arguments on stream", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            ${IMPORT}
            import type { StandardSchemaV1 } from "automate-electron-ipc";
            declare const numberArgs: StandardSchemaV1<unknown, [n: number]>;
            export default defineChannels({
               withTrigger: stream<() => AsyncIterable<number>>({ trigger: "focus" }),
               withQueue: stream<() => AsyncIterable<number>>({ maxQueue: 5 }),
               wrongValidator: stream<(table: string) => AsyncIterable<number>>({ validate: numberArgs }),
               notStream: stream<() => Promise<number>>,
            });
         `,
      });
      expect(diagnostics).toContain("schema.ts(6,");
      expect(diagnostics).toContain("schema.ts(7,");
      expect(diagnostics).toContain("schema.ts(8,");
   });

   it("rejects options and error types on ask", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            ${IMPORT}
            export default defineChannels({
               withOption: ask<() => void>({ timeoutMs: 1 }),
               withErrors: ask<() => void, Error>(),
            });
         `,
      });
      // The option is not accepted, and the second type argument does not exist.
      expect(diagnostics).toContain("schema.ts(4,46): error TS2353");
      expect(diagnostics).toContain("schema.ts(5,32): error TS2558");
   });

   it("keeps the signature of each channel in the type of the map", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            ${IMPORT}
            import type { ChannelDef } from "automate-electron-ipc";

            export const channels = defineChannels({
               getUser: invoke<(id: number) => Promise<string>>(),
            });
            const ok: ChannelDef<(id: number) => Promise<string>> = channels.getUser;
            const bad: ChannelDef<(id: string) => Promise<string>> = channels.getUser;
            export { ok, bad };
         `,
      });
      expect(diagnostics).toContain("schema.ts(9,19): error TS2322");
      expect(diagnostics).not.toContain("schema.ts(8,");
   });

   it("rejects a signature that is not a function type", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            ${IMPORT}
            export default defineChannels({
               notFn: invoke<string>(),
            });
         `,
      });
      expect(diagnostics).toContain("TS2344");
   });

   it("rejects giving the signature in both forms", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            ${IMPORT}
            export default defineChannels({
               both: invoke<(a: string) => void>() as (a: number) => void,
            });
         `,
      });
      expect(diagnostics).toContain("TS2352");
   });

   it("no longer exports the 0.2 syntax", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            import { Channel, type } from "automate-electron-ipc";
            export { Channel, type };
         `,
      });
      expect(diagnostics).toContain("'Channel'");
      expect(diagnostics).toContain("'type'");
   });
});
