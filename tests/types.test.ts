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

import { typecheck } from "@testutils/tsc-utils.js";
import { describe, expect, it } from "vitest";

const IMPORT = 'import { defineChannels, invoke, send, emit, port } from "automate-electron-ipc";';

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

               getUserAlt: invoke({}) as (id: number) => Promise<User>,
               progressAlt: emit({ trigger: "focus" }) as (n: number) => void,
               chatAlt: (port() as (msg: string) => void),
            });
         `,
      });
      expect(diagnostics).toBe("");
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
