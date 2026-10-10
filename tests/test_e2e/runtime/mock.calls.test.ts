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

// T46: the calls of the generated `mock.ts`: stubs, `impl`, `reset` and overrides.

import { type LoadedMock, loadMock } from "@testutils/e2e/mock-utils.js";
import { beforeAll, describe, expect, it, vi } from "vitest";

describe("the generated mock of the API", () => {
   let loaded: LoadedMock;
   beforeAll(async () => {
      loaded = await loadMock();
   });

   describe("calls", () => {
      it("records the calls of an invoke and resolves undefined by default", async () => {
         const mock = loaded.createIpcMock();

         await expect(mock.getUser.invoke(7)).resolves.toBeUndefined();
         await mock.getUser.invoke(8);

         expect(mock.getUser.invoke.calls).toStrictEqual([[7], [8]]);
      });

      it("records the calls of a send, which returns undefined", () => {
         const mock = loaded.createIpcMock();

         expect(mock.logLine.send("line", 2)).toBeUndefined();

         expect(mock.logLine.send.calls).toStrictEqual([["line", 2]]);
      });

      it("returns a stream without chunks, which can be read and cancelled", async () => {
         const mock = loaded.createIpcMock();
         const stream = mock.rows.stream("users");

         const chunks: unknown[] = [];
         for await (const chunk of stream) {
            chunks.push(chunk);
         }

         expect(chunks).toStrictEqual([]);
         expect(mock.rows.stream.calls).toStrictEqual([["users"]]);
         expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
         expect(await stream.return()).toStrictEqual({ done: true, value: undefined });
         expect(stream.cancel()).toBeUndefined();
         expect(stream[Symbol.asyncIterator]()).toBe(stream);
      });

      it("serves the calls to a utility process like the other calls", async () => {
         const mock = loaded.createIpcMock();

         await expect(mock.indexFile.invoke("a")).resolves.toBeUndefined();
         for await (const _ of mock.lines.stream("a")) {
            throw new Error("an empty stream has no chunk");
         }

         expect(mock.indexFile.invoke.calls).toStrictEqual([["a"]]);
         expect(mock.lines.stream.calls).toStrictEqual([["a"]]);
      });

      it("returns an empty path from getPathForFile", () => {
         const mock = loaded.createIpcMock();

         expect(mock.getPathForFile({})).toBe("");
         expect(mock.getPathForFile.calls).toHaveLength(1);
      });
   });

   describe("impl and reset", () => {
      it("replaces the implementation, and keeps recording", async () => {
         const mock = loaded.createIpcMock();
         mock.getUser.invoke.impl(async (id: number) => ({ id, name: "Ann" }));

         await expect(mock.getUser.invoke(3)).resolves.toStrictEqual({ id: 3, name: "Ann" });

         expect(mock.getUser.invoke.calls).toStrictEqual([[3]]);
      });

      it("clears the calls and the implementation on reset, keeping the array", async () => {
         const mock = loaded.createIpcMock();
         const { calls } = mock.getUser.invoke;
         mock.getUser.invoke.impl(async () => "custom");
         await mock.getUser.invoke(1);

         mock.getUser.invoke.reset();

         expect(calls).toHaveLength(0);
         expect(mock.getUser.invoke.calls).toBe(calls);
         await expect(mock.getUser.invoke(2)).resolves.toBeUndefined();
      });

      it("does not share a stub between mocks", async () => {
         const first = loaded.createIpcMock();
         const second = loaded.createIpcMock();

         await first.getUser.invoke(1);

         expect(second.getUser.invoke.calls).toHaveLength(0);
      });
   });

   describe("overrides", () => {
      it("gives a call the implementation of the override", async () => {
         const mock = loaded.createIpcMock({
            getUser: { invoke: async (id: number) => ({ id, name: "Bob" }) },
         });

         await expect(mock.getUser.invoke(5)).resolves.toStrictEqual({ id: 5, name: "Bob" });

         expect(mock.getUser.invoke.calls).toStrictEqual([[5]]);
         await mock.getUser.invoke.reset();
         await expect(mock.getUser.invoke(5)).resolves.toBeUndefined();
      });

      it("replaces the methods and values that are not stubs", () => {
         const subscribe = vi.fn(() => () => undefined);
         const mock = loaded.createIpcMock({
            titleChanged: { on: subscribe },
            getPathForFile: () => "/tmp/x",
         });

         mock.titleChanged.on(() => undefined);

         expect(subscribe).toHaveBeenCalledTimes(1);
         expect(mock.getPathForFile({})).toBe("/tmp/x");
         expect(mock.titleChanged.once).toBeTypeOf("function");
      });

      it("refuses a member that the API does not have", () => {
         expect(() => loaded.createIpcMock({ nope: {} })).toThrow("The mock has no member 'nope'");
         expect(() => loaded.createIpcMock({ getUser: { nope: 1 } })).toThrow(
            "The mock has no member 'nope'",
         );
         expect(() => loaded.createIpcMock(JSON.parse('{"__proto__": {}}'))).toThrow(
            "The mock has no member '__proto__'",
         );
      });
   });
});
