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

import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import {
   type Contents,
   callFrom,
   createContents,
   disposeScopesFixture,
   forbidden,
   loadMain,
} from "@testutils/scopes-main-utils.js";
import { afterEach, describe, expect, it } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   await disposeScopesFixture();
   await project?.cleanup();
   project = undefined;
});

describe("registerScope, and the channels with scopes in the main process", () => {
   describe("the registration", () => {
      it("is removed by the function that registerScope returns", async () => {
         const { generated, ipc, call } = await loadMain();
         const settings = createContents(1);
         const dispose = generated.registerScope(settings, "settings");
         ipc.getSettings.handle(async () => ({ theme: "dark" }));
         await expect(call("getSettings", callFrom(settings))).resolves.toMatchObject({ ok: true });

         dispose();

         await expect(call("getSettings", callFrom(settings))).resolves.toStrictEqual(
            forbidden("getSettings"),
         );
         expect(settings.listenerCount("destroyed")).toBe(0);
      });

      it("is replaced when the contents are registered again, and the old disposer does nothing", async () => {
         const { generated, ipc, call } = await loadMain();
         const contents = createContents(1);
         const disposeFirst = generated.registerScope(contents, "settings");
         generated.registerScope(contents, "editor");
         ipc.getSettings.handle(async () => ({ theme: "dark" }));
         ipc.openFile.handle(async () => ({ path: "", text: "" }));

         disposeFirst();

         await expect(call("getSettings", callFrom(contents))).resolves.toStrictEqual(
            forbidden("getSettings"),
         );
         await expect(call("openFile", callFrom(contents), "a")).resolves.toMatchObject({
            ok: true,
         });
         expect(contents.listenerCount("destroyed")).toBe(1);
      });

      it("is removed when the contents are destroyed", async () => {
         const { generated, ipc, call } = await loadMain();
         const contents = createContents(1);
         generated.registerScope(contents, "settings");
         ipc.getSettings.handle(async () => ({ theme: "dark" }));

         contents.destroy();

         expect(contents.listenerCount("destroyed")).toBe(0);
         await expect(call("getSettings", callFrom(contents))).resolves.toStrictEqual(
            forbidden("getSettings"),
         );
      });

      it("takes the contents of a window or a view", async () => {
         const { generated, ipc, call } = await loadMain();
         const window = { webContents: createContents(1) };
         const view = { webContents: createContents(2) };
         generated.registerScope(window, "settings");
         generated.registerScope(view, "settings");
         ipc.getSettings.handle(async () => ({ theme: "dark" }));

         await expect(call("getSettings", callFrom(window.webContents))).resolves.toMatchObject({
            ok: true,
         });
         await expect(call("getSettings", callFrom(view.webContents))).resolves.toMatchObject({
            ok: true,
         });
      });

      it("throws for a scope that the schema does not declare, and registers nothing", async () => {
         const { generated } = await loadMain();
         const contents = createContents(1);

         expect(() => generated.registerScope(contents, "admin")).toThrowError(
            "The scope 'admin' is not declared in the schema. Use one of: editor, settings",
         );
         expect(contents.listenerCount("destroyed")).toBe(0);
      });

      it("throws for contents that are destroyed already", async () => {
         const { generated } = await loadMain();
         const contents = createContents(1);
         contents.destroyed = true;

         expect(() => generated.registerScope(contents, "settings")).toThrowError(
            "Object has been destroyed",
         );
         expect(contents.listenerCount("destroyed")).toBe(0);
      });

      it("does not pick up a name of Object.prototype as a registration", async () => {
         const { ipc, call } = await loadMain();
         ipc.getSettings.handle(async () => ({ theme: "dark" }));

         // The contents have an ID that is the name of a property of every object.
         const event = callFrom({ id: "constructor" } as unknown as Contents);

         await expect(call("getSettings", event)).resolves.toStrictEqual(forbidden("getSettings"));
      });
   });
});

describe("a schema where the scopes only name channels that the main process does not guard", () => {
   it("still exports registerScope, with the guard of the sender unchanged", async () => {
      project = await runFixture("scoped-emit-only");
      const main = project.generated["main.ts"];

      expect(main).toContain("export function registerScope(");
      expect(main).not.toContain("scopes?: readonly IpcScope[]");
      expect(await project.typecheckScope("hud")).toBe("");
   });
});
