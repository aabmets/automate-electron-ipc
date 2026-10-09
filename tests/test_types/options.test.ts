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
   it("accepts the scopes option on every channel that a page takes part in", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            ${IMPORT}
            import { invokeUtility, streamUtility } from "automate-electron-ipc";

            export default defineChannels({
               getUser: invoke<(id: number) => Promise<string>>({ scopes: ["settings", "editor"] }),
               note: send<(text: string) => void>({ scopes: ["settings"], allowedOrigins: ["app://."] }),
               progress: emit<(n: number) => void>({ scopes: ["editor"], trigger: "focus" }),
               dirty: ask<() => boolean>({ scopes: ["editor"] }),
               rows: stream<() => AsyncIterable<number>>({ scopes: ["editor"] }),
               chat: port<(msg: string) => void>({ scopes: ["editor"], maxQueue: 10 }),
               logTail: mainPort<(line: string) => void>({ scopes: ["settings"] }),
               query: invokeUtility<(sql: string) => Promise<number>>({ scopes: ["settings"] }),
               scan: streamUtility<() => AsyncIterable<number>>({ scopes: ["settings"] }),
               getUserAlt: invoke({ scopes: ["settings"] }) as (id: number) => Promise<string>,
            });
         `,
      });
      expect(diagnostics).toBe("");
   });

   it("rejects scopes that are not a list of strings, and on channels with no page", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            ${IMPORT}
            import { callUtility, notifyMain } from "automate-electron-ipc";

            export default defineChannels({
               notAList: invoke<() => Promise<number>>({ scopes: "settings" }),
               notStrings: send<() => void>({ scopes: [1] }),
               toUtility: callUtility<() => Promise<number>>({ scopes: ["settings"] }),
               fromUtility: notifyMain<() => void>({ scopes: ["settings"] }),
            });
         `,
      });
      for (const line of [6, 7, 8, 9]) {
         expect(diagnostics).toContain(`schema.ts(${line},`);
      }
   });

   it("accepts the verbs of the service worker channels, with their own options", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            ${IMPORT}
            import { askWorker, emitToWorker, invokeFromWorker, sendFromWorker } from "automate-electron-ipc";
            import type { StandardSchemaV1 } from "automate-electron-ipc";

            declare const nameArgs: StandardSchemaV1<unknown, [name: string]>;
            declare const countArgs: StandardSchemaV1<unknown, [n: number]>;

            export default defineChannels({
               getToken: invokeFromWorker<(scope: string) => Promise<string>, Error>(),
               saveBlob: invokeFromWorker<(name: string) => number>({
                  allowedOrigins: ["app://."],
                  validate: nameArgs,
                  timeoutMs: 2000,
               }),
               syncDone: sendFromWorker<(n: number) => void>({
                  allowedOrigins: ["app://."],
                  validate: countArgs,
               }),
               flush: askWorker<(force: boolean) => number>(),
               changed: emitToWorker<(key: string) => void>(),
               asForm: invokeFromWorker() as (id: number) => Promise<string>,
            });
         `,
      });
      expect(diagnostics).toBe("");
   });

   it("rejects the options that the service worker verbs do not have", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            ${IMPORT}
            import { askWorker, emitToWorker, invokeFromWorker, sendFromWorker, type StandardSchemaV1 } from "automate-electron-ipc";

            export default defineChannels({
               a: sendFromWorker<() => void>({ timeoutMs: 5 }),
               b: invokeFromWorker<() => void>({ scopes: ["a"] }),
               c: sendFromWorker<() => void>({ scopes: ["a"] }),
               d: askWorker<() => void>({ allowedOrigins: ["app://."] }),
               e: emitToWorker<() => void>({ trigger: "focus" }),
               f: sendFromWorker<() => void, Error>(),
               g: askWorker<() => void, Error>(),
               h: askWorker<() => void>({ timeoutMs: 5 }),
               i: emitToWorker<() => void>({ validate: {} as StandardSchemaV1<unknown, []> }),
               j: invokeFromWorker<(id: number) => void>({ validate: undefined as unknown as StandardSchemaV1<unknown, [id: string]> }),
            });
         `,
      });
      for (const line of [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
         expect(diagnostics).toContain(`schema.ts(${line},`);
      }
   });

   it("rejects options that the verb does not support", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            ${IMPORT}
            export default defineChannels({
               a: invoke<() => void>({ trigger: "focus" }),
               b: send<() => void>({ trigger: "focus" }),
               c: port<() => void>({ trigger: "focus" }),
               d: emit<() => void>({ other: true }),
               e: send({ trigger: "focus" }) as () => void,
            });
         `,
      });
      for (const line of [4, 5, 6, 7, 8]) {
         expect(diagnostics).toContain(`schema.ts(${line},`);
      }
   });

   it("accepts allowedOrigins on invoke and send only", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            ${IMPORT}
            export default defineChannels({
               a: invoke<() => void>({ allowedOrigins: ["app://."] }),
               b: send<() => void>({ allowedOrigins: ["app://.", "http://localhost:5173"] }),
               c: send({ allowedOrigins: ["app://."] }) as () => void,
               d: emit<() => void>({ allowedOrigins: ["app://."] }),
               e: port<() => void>({ allowedOrigins: ["app://."] }),
               f: invoke<() => void>({ allowedOrigins: "app://." }),
            });
         `,
      });
      for (const line of [4, 5, 6]) {
         expect(diagnostics).not.toContain(`schema.ts(${line},`);
      }
      for (const line of [7, 8, 9]) {
         expect(diagnostics).toContain(`schema.ts(${line},`);
      }
   });

   it("types validate against the argument tuple of the signature", async () => {
      const diagnostics = await typecheck({
         "validators.ts": `
            import type { StandardSchemaV1 } from "automate-electron-ipc";
            declare function schema<T>(): StandardSchemaV1<unknown, T>;
            export const idArgs = schema<[id: number]>();
            export const idInput = schema<[id: unknown]>();
            export const wide = schema<[id: number | string]>();
            export const two = schema<[id: number, extra: string]>();
            export const none = schema<[]>();
            export const rest = schema<[text: string, ...rest: number[]]>();
            export const notSchema = { validate: () => true };
         `,
         "schema.ts": `
            ${IMPORT}
            import { idArgs, wide, two, none, rest, notSchema } from "./validators";
            export default defineChannels({
               a: invoke<(id: number) => void>({ validate: idArgs }),
               b: send<(text: string, ...rest: number[]) => void>({ validate: rest }),
               c: send<() => void>({ validate: none }),
               d: invoke({ validate: idArgs }) as (id: number) => void,
               e: invoke<(id: number) => void>({ validate: wide }),
               f: invoke<(id: number) => void>({ validate: two }),
               g: invoke<(id: string) => void>({ validate: idArgs }),
               h: invoke<(id: number) => void>({ validate: notSchema }),
               i: emit<(id: number) => void>({ validate: idArgs }),
               j: port<(id: number) => void>({ validate: idArgs }),
            });
         `,
      });
      for (const line of [5, 6, 7, 8]) {
         expect(diagnostics).not.toContain(`schema.ts(${line},`);
      }
      // A schema whose output does not fit the signature, one that is not a schema, and the
      // verbs that take no validator. The `as` form does not check the signature.
      for (const line of [9, 10, 11, 12, 13, 14]) {
         expect(diagnostics).toContain(`schema.ts(${line},`);
      }
      expect(diagnostics).not.toContain("validators.ts(");
   });

   it("rejects a trigger which is not a BrowserWindow event", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            ${IMPORT}
            export default defineChannels({
               a: emit<() => void>({ trigger: "not-an-event" }),
            });
         `,
      });
      expect(diagnostics).toContain("schema.ts(4,");
   });
});
