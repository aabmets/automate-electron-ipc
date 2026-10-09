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

import { currentProject } from "@testutils/e2e/runtime-main-utils.js";
import {
   callCount,
   fail,
   isNumber,
   loadValidated,
   ok,
} from "@testutils/e2e/runtime-validation-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { describe, expect, it, vi } from "vitest";

describe("generated main process bindings", () => {
   describe("argument validation", () => {
      it("exports IpcValidationError only when a channel has a validator", async () => {
         const { generated } = await loadValidated();
         const error = new generated.IpcValidationError("getCount", [{ message: "bad" }]);
         expect(error).toBeInstanceOf(Error);
         expect(error.name).toBe("IpcValidationError");
         expect(error.channel).toBe("getCount");
         expect(error.issues).toStrictEqual([{ message: "bad" }]);
         expect(error.message).toBe("The arguments of the channel 'getCount' are invalid: bad");
         await currentProject()?.cleanup();

         const project = await fixtures.run("sender-validation");
         expect(project.generated["main.ts"]).not.toContain("IpcValidationError");
      });

      it("runs the handler with the validated arguments when the schema accepts", async () => {
         const { handlers, ipc, id } = await loadValidated();
         const callback = vi.fn((_event: unknown, value: number) => value + 1);
         ipc.getCount.handle(callback);

         await expect(callCount(handlers, 4)).resolves.toBe(5);
         expect(id.validate).toHaveBeenCalledWith([4]);
         expect(callback).toHaveBeenCalledWith({}, 4);
      });

      it("passes the arguments exactly as they arrived, so a schema sees extra ones", async () => {
         const { handlers, ipc, id } = await loadValidated();
         ipc.getCount.handle(vi.fn());

         await expect(callCount(handlers, 4, "extra")).rejects.toThrowError(/expected one number/);
         await expect(callCount(handlers)).rejects.toThrowError(/expected one number/);
         expect(id.validate.mock.calls).toStrictEqual([[[4, "extra"]], [[]]]);
      });

      it("gives the handler the output of the schema, not the input", async () => {
         const { handlers, ipc } = await loadValidated({
            id: (value) => ok([Number((value as unknown[])[0]) * 2]),
         });
         const callback = vi.fn();
         ipc.getCount.handle(callback);

         await callCount(handlers, "21");

         expect(callback).toHaveBeenCalledWith({}, 42);
      });

      it("rejects an invoke with an IpcValidationError that carries the issues", async () => {
         const { generated, handlers, ipc } = await loadValidated({
            id: () => ({ issues: [{ message: "bad id", path: ["0"] }, { message: "again" }] }),
         });
         const callback = vi.fn();
         ipc.getCount.handle(callback);

         const error = await callCount(handlers, "x").catch((thrown: unknown) => thrown);

         expect(generated.IpcValidationError).toBeTypeOf("function");
         expect(error).toMatchObject({
            name: "IpcValidationError",
            code: "IPC_VALIDATION",
            data: [{ message: "bad id", path: ["0"] }, { message: "again" }],
         });
         expect((error as Error).message).toContain("bad id; again");
         expect(callback).not.toHaveBeenCalled();
      });

      it("sends the paths of the issues as plain strings and numbers, which can be cloned", async () => {
         const symbol = Symbol("secret");
         const { handlers, ipc } = await loadValidated({
            id: () => ({
               issues: [{ message: "bad", path: [symbol, { key: 2 }, { key: symbol }, "name"] }],
            }),
         });
         ipc.getCount.handle(vi.fn());

         const error = await callCount(handlers, "x").catch((thrown: unknown) => thrown);

         expect((error as { data: unknown }).data).toStrictEqual([
            { message: "bad", path: ["Symbol(secret)", 2, "Symbol(secret)", "name"] },
         ]);
         expect(() => structuredClone((error as { data: unknown }).data)).not.toThrow();
      });

      it("drops an invalid send, and delivers a valid one with its rest arguments", async () => {
         const { emitter, ipc, line } = await loadValidated({
            line: (value) =>
               typeof (value as unknown[])[0] === "string" ? ok(value) : fail("text"),
         });
         const callback = vi.fn();
         ipc.logLine.on(callback);

         expect(() => emitter.emit("logLine", {}, 5)).not.toThrow();
         emitter.emit("logLine", {}, "ok", 1, 2);

         expect(callback).toHaveBeenCalledOnce();
         expect(callback).toHaveBeenCalledWith({}, "ok", 1, 2);
         expect(line.validate).toHaveBeenCalledWith(["ok", 1, 2]);
      });

      it("accepts a default import as the validator", async () => {
         const { emitter, ipc, none } = await loadValidated({
            none: (value) => ((value as unknown[]).length === 0 ? ok(value) : fail("none")),
         });
         const callback = vi.fn();
         ipc.ping.on(callback);

         emitter.emit("ping", {}, "extra");
         emitter.emit("ping", {});

         expect(none.validate).toHaveBeenCalledTimes(2);
         expect(callback).toHaveBeenCalledOnce();
      });

      it("awaits an asynchronous schema before it runs the handler", async () => {
         const { handlers, ipc } = await loadValidated({ id: async (value) => isNumber(value) });
         const callback = vi.fn(async (_event: unknown, value: number) => value * 3);
         ipc.getCount.handle(callback);

         const answer = callCount(handlers, 2) as Promise<number>;
         expect(callback).not.toHaveBeenCalled();
         await expect(answer).resolves.toBe(6);
         await expect(callCount(handlers, "2")).rejects.toThrowError(/expected one number/);
         expect(callback).toHaveBeenCalledOnce();
      });

      it("drops an invalid send of an asynchronous schema without an unhandled rejection", async () => {
         const { emitter, ipc } = await loadValidated({ line: async () => fail("late") });
         const callback = vi.fn();
         const unhandled = vi.fn();
         process.on("unhandledRejection", unhandled);
         try {
            ipc.logLine.on(callback);
            emitter.emit("logLine", {}, "x");
            await new Promise((resolve) => setTimeout(resolve, 5));
         } finally {
            process.off("unhandledRejection", unhandled);
         }
         expect(callback).not.toHaveBeenCalled();
         expect(unhandled).not.toHaveBeenCalled();
      });

      it.each([
         [
            "throws",
            () => {
               throw new Error("secret internals");
            },
         ],
         ["rejects", () => Promise.reject(new Error("secret internals"))],
      ])("rejects when the schema %s, without passing on its message", async (_name, validate) => {
         const { generated, handlers, ipc } = await loadValidated({ id: validate });
         const callback = vi.fn();
         ipc.getCount.handle(callback);

         const result = await callCount(handlers, 1).catch((error: unknown) => error);

         expect(generated.IpcValidationError).toBeTypeOf("function");
         expect(result).toMatchObject({ name: "IpcValidationError" });
         expect(String((result as Error).message)).not.toContain("secret");
         expect(callback).not.toHaveBeenCalled();
      });

      it.each([
         ["a result without an array", () => ok("not an array")],
         ["no result", () => undefined],
         ["a null result", () => null],
      ])("rejects when the schema answers with %s", async (_name, validate) => {
         const { handlers, ipc } = await loadValidated({ id: validate });
         const callback = vi.fn();
         ipc.getCount.handle(callback);

         await expect(callCount(handlers, 1)).rejects.toThrowError(/invalid/);
         expect(callback).not.toHaveBeenCalled();
      });
   });
});
