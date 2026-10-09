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

import { type E2EProject } from "@testutils/e2e-utils.js";
import { errorsMainLoader } from "@testutils/errors-main-utils.js";
import { createFakePreloadElectron, loadGenerated } from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   await project?.cleanup();
   project = undefined;
});

const loadMain = errorsMainLoader((created) => {
   project = created;
});

describe("generated error envelope of the main process", () => {
   const reply = async (handle: () => unknown) => {
      const { handlerOf, ipc } = await loadMain("error-envelope");
      ipc.getPlain.handle(handle);
      return handlerOf("getPlain")({});
   };

   it("answers a returned value with an ok envelope", async () => {
      await expect(reply(() => 7)).resolves.toStrictEqual({ ok: true, value: 7 });
      await expect(reply(async () => "later")).resolves.toStrictEqual({ ok: true, value: "later" });
      await expect(reply(() => undefined)).resolves.toStrictEqual({ ok: true, value: undefined });
   });

   it("answers a thrown Error with its name and message, and never its stack", async () => {
      const result = await reply(() => {
         throw new TypeError("boom");
      });

      expect(result).toStrictEqual({ ok: false, error: { name: "TypeError", message: "boom" } });
   });

   it("answers a rejected promise like a thrown error", async () => {
      const result = await reply(() => Promise.reject(new Error("later")));

      expect(result).toStrictEqual({ ok: false, error: { name: "Error", message: "later" } });
   });

   it("keeps the code and the data of a custom error", async () => {
      class NotFoundError extends Error {
         override readonly name = "NotFoundError";
         readonly code = "NOT_FOUND";
         readonly data = { id: 7, tags: ["a"] };
      }
      const result = await reply(() => {
         throw new NotFoundError("no user");
      });

      expect(result).toStrictEqual({
         ok: false,
         error: {
            name: "NotFoundError",
            message: "no user",
            code: "NOT_FOUND",
            data: { id: 7, tags: ["a"] },
         },
      });
   });

   it("keeps a numeric code, and ignores a code of any other type", async () => {
      const numeric = await reply(() => {
         throw Object.assign(new Error("denied"), { code: 401 });
      });
      const other = await reply(() => {
         throw Object.assign(new Error("odd"), { code: { nested: true } });
      });

      expect(numeric.error.code).toBe(401);
      expect(other.error).toStrictEqual({ name: "Error", message: "odd" });
   });

   it("sends a copy of the data, not the object of the handler", async () => {
      const data = { id: 1 };
      const result = await reply(() => {
         throw Object.assign(new Error("x"), { data });
      });

      expect(result.error.data).toStrictEqual({ id: 1 });
      expect(result.error.data).not.toBe(data);
   });

   it("leaves out data that cannot be cloned, so the reply itself does not fail", async () => {
      const result = await reply(() => {
         throw Object.assign(new Error("x"), { code: "E_X", data: { callback: () => 1 } });
      });

      expect(result).toStrictEqual({
         ok: false,
         error: { name: "Error", message: "x", code: "E_X" },
      });
   });

   it.each([
      ["a string", "oops", { name: "Error", message: "oops" }],
      ["a number", 42, { name: "Error", message: "42" }],
      ["null", null, { name: "Error", message: "null" }],
      ["undefined", undefined, { name: "Error", message: "undefined" }],
      [
         "an object without a message",
         { code: 5 },
         { name: "Error", message: "[object Object]", code: 5 },
      ],
      [
         "an error with an empty name",
         Object.assign(new Error("m"), { name: "" }),
         { name: "Error", message: "m" },
      ],
      [
         "an object with a message",
         { name: "Custom", message: "plain" },
         { name: "Custom", message: "plain" },
      ],
   ])("answers a thrown value which is %s", async (_label, thrown, error) => {
      const result = await reply(() => {
         throw thrown;
      });

      expect(result).toStrictEqual({ ok: false, error });
   });

   it("answers with a fixed message when what was thrown cannot be read", async () => {
      const hostile = new Proxy(
         {},
         {
            get() {
               throw new Error("trap");
            },
         },
      );
      const result = await reply(() => {
         throw hostile;
      });

      expect(result).toStrictEqual({
         ok: false,
         error: { name: "Error", message: "The handler failed with an unreadable error" },
      });
   });

   it("registers the same envelope for handleOnce", async () => {
      const { handlerOf, ipc } = await loadMain("error-envelope");
      ipc.getPlain.handleOnce(() => {
         throw new RangeError("once");
      });

      await expect(handlerOf("getPlain")({})).resolves.toStrictEqual({
         ok: false,
         error: { name: "RangeError", message: "once" },
      });
   });

   it("leaves the listeners of send channels alone", async () => {
      const { electron, ipc } = await loadMain("error-envelope");
      const callback = vi.fn(() => "ignored");
      ipc.ping.on(callback);

      const [, wrapper] = electron.ipcMain.on.mock.calls[0];
      expect(wrapper({})).toBe("ignored");
   });
});

describe("generated error round trip, from the handler to the renderer", () => {
   /** Wires the generated preload to the handlers that the generated main registered. */
   async function connect(fixture: string) {
      const { handlerOf, ipc } = await loadMain(fixture);
      const fake = createFakePreloadElectron();
      fake.electron.ipcRenderer.invoke.mockImplementation((channel: string, ...args: unknown[]) =>
         handlerOf(channel.replace("autoipc:", ""))({ sender: "renderer" }, ...args),
      );
      loadGenerated(project?.generated["preload.ts"] as string, { electron: fake.electron });
      return { main: ipc, renderer: fake.exposed.ipc };
   }

   it("resolves with the value that the handler returned", async () => {
      const { main, renderer } = await connect("error-envelope");
      main.getUser.handle(async (_event: unknown, id: number) => `user ${id}`);

      await expect(renderer.getUser.invoke(3)).resolves.toBe("user 3");
   });

   it("rejects with a plain object that carries every field of the error", async () => {
      const { main, renderer } = await connect("error-envelope");
      main.getUser.handle(() => {
         throw Object.assign(new Error("not found"), {
            name: "NotFoundError",
            code: "NOT_FOUND",
            data: { id: 1 },
         });
      });

      const error = await renderer.getUser.invoke(1).catch((thrown: unknown) => thrown);

      expect(error).toStrictEqual({
         name: "NotFoundError",
         message: "not found",
         code: "NOT_FOUND",
         data: { id: 1 },
      });
      // contextBridge copies a thrown Error without its custom fields, so it must not be one.
      expect(error).not.toBeInstanceOf(Error);
   });

   it("rejects a call from a sender that is not allowed with a coded error", async () => {
      const { generated, handlerOf, ipc } = await loadMain("sender-validation");
      expect(generated.configureIpc).toBeTypeOf("function");
      ipc.getSecret.handle(async () => "secret");

      const reply = await handlerOf("getSecret")({ senderFrame: { origin: "https://evil" } }, 1);

      expect(reply).toMatchObject({
         ok: false,
         error: { name: "IpcForbiddenError", code: "IPC_FORBIDDEN" },
      });
   });

   it("keeps working after an error, so the next call can succeed", async () => {
      const { main, renderer } = await connect("error-envelope");
      let calls = 0;
      main.getPlain.handle(() => {
         calls++;
         if (calls === 1) {
            throw new Error("first");
         }
         return calls;
      });

      await expect(renderer.getPlain.invoke()).rejects.toMatchObject({ message: "first" });
      await expect(renderer.getPlain.invoke()).resolves.toBe(2);
   });
});
