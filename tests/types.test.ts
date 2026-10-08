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
               GetUser: invoke<(id: number) => Promise<User>>(),
               EchoUserName: send<(userName: string) => void>({}),
               Progress: emit<(n: number) => void>({ trigger: "focus" }),
               Chat: port<(msg: string) => void>(),

               GetUserAlt: invoke({}) as (id: number) => Promise<User>,
               ProgressAlt: emit({ trigger: "focus" }) as (n: number) => void,
               ChatAlt: (port() as (msg: string) => void),
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
               GetUser: invoke<(id: number) => Promise<string>>(),
            });
            const ok: ChannelDef<(id: number) => Promise<string>> = channels.GetUser;
            const bad: ChannelDef<(id: string) => Promise<string>> = channels.GetUser;
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
               NotFn: invoke<string>(),
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
               Both: invoke<(a: string) => void>() as (a: number) => void,
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
               A: invoke<() => void>({ trigger: "focus" }),
               B: send<() => void>({ trigger: "focus" }),
               C: port<() => void>({ trigger: "focus" }),
               D: emit<() => void>({ other: true }),
               E: send({ trigger: "focus" }) as () => void,
            });
         `,
      });
      for (const line of [4, 5, 6, 7, 8]) {
         expect(diagnostics).toContain(`schema.ts(${line},`);
      }
   });

   it("rejects a trigger which is not a BrowserWindow event", async () => {
      const diagnostics = await typecheck({
         "schema.ts": `
            ${IMPORT}
            export default defineChannels({
               A: emit<() => void>({ trigger: "not-an-event" }),
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
