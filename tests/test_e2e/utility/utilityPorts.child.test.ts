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

// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures, and have nothing to await
// biome-ignore-all lint/style/useThrowOnlyError: a plain object is what a handler may throw, and the library reduces it

import { loadGenerated } from "@testutils/e2e/runtime-utils.js";
import {
   call,
   cleanupUtilityPorts,
   FakeBrokerPort,
   flush,
   loadUtility,
   ok,
   startStream,
   wire,
} from "@testutils/e2e/utility-port-utils.js";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   vi.restoreAllMocks();
   await project?.cleanup();
   project = undefined;
   await cleanupUtilityPorts();
});

describe("utility ports, the utility process, accepting ports", () => {
   it("starts a port of a channel of the file, and ignores the messages of other channels on it", async () => {
      const { ipc, broker } = await loadUtility();
      const handler = vi.fn(async () => []);
      ipc.queryRows.handle(handler);

      const port = broker("queryRows");
      port.fromPage(call("countRows", 1, "rows"));
      await flush();

      expect(port.start).toHaveBeenCalledTimes(1);
      expect(handler).not.toHaveBeenCalled();
      expect(port.postMessage).not.toHaveBeenCalled();
   });

   it("closes a port of a channel it does not know, and a port message without a port is left alone", async () => {
      const { ipc, broker, emitFromMain } = await loadUtility();
      ipc.queryRows.handle(async () => []);

      const unknown = broker("getUser");
      const other = broker("somethingElse");
      emitFromMain({ __ipc: "port", channel: wire("queryRows"), key: "k" });
      emitFromMain({ __ipc: "port", channel: 7, key: "k" }, [new FakeBrokerPort()]);

      expect(unknown.close).toHaveBeenCalledTimes(1);
      expect(unknown.start).not.toHaveBeenCalled();
      expect(other.close).toHaveBeenCalledTimes(1);
   });

   it("leaves the other messages of the main process to the channels between the two", async () => {
      const { ipc, emitFromMain, port } = await loadUtility();
      ipc.indexFile.handle(async (path: string) => path.length);

      emitFromMain(null);
      emitFromMain("text");
      emitFromMain(call("indexFile", 9, "abc"));
      await flush();

      expect(port.postMessage).toHaveBeenCalledWith({
         __ipc: "reply",
         channel: wire("indexFile"),
         id: 9,
         envelope: ok(3),
      });
   });

   it("listens to the main process as soon as a handler is registered, since a port may arrive first", async () => {
      const { ipc, port } = await loadUtility();
      expect(port.listenerCount("message")).toBe(0);

      ipc.queryRows.handle(async () => []);

      expect(port.listenerCount("message")).toBe(1);
   });

   it("fails outside a utility process, like the other channels", async () => {
      project = await runFixture("utility-ports");
      const utility = loadGenerated(project.generated["utility.ts"] ?? "", {});

      expect(() => utility.ipc.queryRows.handle(async () => [])).toThrow(TypeError);
      expect(() =>
         utility.ipc.scanRows.handle(async function* () {
            yield { id: 1, label: "x" };
         }),
      ).toThrow("only in an Electron utility process");
   });
});

describe("utility ports, the utility process, calls", () => {
   it("calls the handler with the arguments, and answers with the envelope", async () => {
      const { ipc, broker } = await loadUtility();
      const handler = vi.fn(async (sql: string, limit?: number) => [
         { id: sql.length, label: String(limit) },
      ]);
      ipc.queryRows.handle(handler);
      const port = broker("queryRows");

      port.fromPage(call("queryRows", 4, "select", 3));
      await flush();

      expect(handler).toHaveBeenCalledWith("select", 3);
      expect(port.posted("reply")).toStrictEqual([
         {
            __ipc: "reply",
            channel: wire("queryRows"),
            id: 4,
            envelope: ok([{ id: 6, label: "3" }]),
         },
      ]);
   });

   it("spreads rest arguments, and answers a handler which is not async", async () => {
      const { ipc, broker } = await loadUtility();
      ipc.tagged.handle(async (label: string, ...tags: string[]) => `${label}:${tags.join(",")}`);
      ipc.countRows.handle((table: string) => table.length);
      const tagged = broker("tagged");
      const count = broker("countRows");

      tagged.fromPage(call("tagged", 1, "a", "b", "c"));
      count.fromPage(call("countRows", 2, "rows"));
      await flush();

      expect(tagged.posted("reply")[0].envelope).toStrictEqual(ok("a:b,c"));
      expect(count.posted("reply")[0].envelope).toStrictEqual(ok(4));
   });

   it("answers with the error that the handler threw, as name, message, code and data", async () => {
      const { ipc, broker } = await loadUtility();
      ipc.queryRows.handle(async () => {
         throw { name: "QueryError", message: "no table", code: "E_QUERY", data: { sql: "x" } };
      });
      const port = broker("queryRows");

      port.fromPage(call("queryRows", 1, "x"));
      await flush();

      expect(port.posted("reply")[0].envelope).toStrictEqual({
         ok: false,
         error: { name: "QueryError", message: "no table", code: "E_QUERY", data: { sql: "x" } },
      });
   });

   it("answers a call without a handler with IPC_UTILITY_NO_HANDLER, so that the page does not wait", async () => {
      const { ipc, broker } = await loadUtility();
      ipc.scanRows.handle(async function* () {
         yield { id: 1, label: "x" };
      });
      const port = broker("queryRows");
      const streams = broker("scanRows");

      port.fromPage(call("queryRows", 1, "x"));
      // A stream handler is not a handler of calls.
      streams.fromPage(call("scanRows", 2, "rows"));
      await flush();

      expect(port.posted("reply")[0].envelope).toMatchObject({
         ok: false,
         error: { name: "IpcUtilityError", code: "IPC_UTILITY_NO_HANDLER" },
      });
      expect(streams.posted("reply")[0].envelope).toMatchObject({
         error: { code: "IPC_UTILITY_NO_HANDLER" },
      });
   });

   it("replaces the handler, and the disposer of a replaced handler removes nothing", async () => {
      const { ipc, broker } = await loadUtility();
      const first = vi.fn(async () => ["first"]);
      const second = vi.fn(async () => ["second"]);
      const removeFirst: () => void = ipc.queryRows.handle(first);
      const removeSecond: () => void = ipc.queryRows.handle(second);
      const port = broker("queryRows");

      removeFirst();
      port.fromPage(call("queryRows", 1, "x"));
      await flush();
      expect(second).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();

      removeSecond();
      port.fromPage(call("queryRows", 2, "x"));
      await flush();
      expect(port.posted("reply")[1].envelope).toMatchObject({
         error: { code: "IPC_UTILITY_NO_HANDLER" },
      });
   });

   it("replaces the answer with an error when the value cannot be sent", async () => {
      const { ipc, broker } = await loadUtility();
      ipc.queryRows.handle(async () => [{ id: 1, label: "x" }]);
      const port = broker("queryRows");
      port.postMessage.mockImplementationOnce(() => {
         throw new Error("could not be cloned");
      });

      port.fromPage(call("queryRows", 1, "x"));
      await flush();

      // The first attempt threw, and the second one carries the error.
      expect(port.posted("reply")).toHaveLength(2);
      expect(port.posted("reply")[1].envelope).toMatchObject({
         ok: false,
         error: { name: "IpcUtilityError", code: "IPC_UTILITY_UNSENDABLE" },
      });
      expect(port.posted("reply")[1].envelope.error.message).toContain("could not be cloned");
   });

   it("ignores messages of an unknown shape, and answers none after the port closed", async () => {
      const { ipc, broker } = await loadUtility();
      let finish: (value: unknown[]) => void = () => undefined;
      ipc.queryRows.handle(() => new Promise<unknown[]>((resolve) => (finish = resolve)));
      const port = broker("queryRows");

      for (const junk of [null, "text", 7, [], {}, { __ipc: "call" }, { __ipc: "stream" }]) {
         port.fromPage(junk);
      }
      port.fromPage({ ...call("queryRows", 1, "x"), args: "not a list" });
      port.fromPage({ ...startStream("queryRows", "1" as unknown as number), args: [] });
      port.fromPage(call("queryRows", 2, "x"));
      port.emit("close");
      finish([]);
      await flush();

      expect(port.postMessage).not.toHaveBeenCalled();
   });
});
