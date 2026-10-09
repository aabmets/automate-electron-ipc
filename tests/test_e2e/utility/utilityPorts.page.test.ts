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

import {
   cleanupUtilityPorts,
   loadPage,
   ok,
   settled,
   wire,
} from "@testutils/e2e/utility-port-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
   vi.restoreAllMocks();
   await cleanupUtilityPorts();
});

describe("utility ports, the page, calls", () => {
   it("waits for the port of the connection, then posts the calls in order", async () => {
      const { api, arrive } = await loadPage();

      const first = api.queryRows.invoke("select 1", 5);
      const second = api.queryRows.invoke("select 2");
      const port = arrive("queryRows");

      const [one, two] = port.posted("call");
      expect(one).toStrictEqual({
         __ipc: "call",
         channel: wire("queryRows"),
         id: expect.any(Number),
         args: ["select 1", 5],
      });
      expect(two.args).toStrictEqual(["select 2"]);
      expect(two.id).not.toBe(one.id);
      port.deliver({ __ipc: "reply", channel: wire("queryRows"), id: two.id, envelope: ok(2) });
      port.deliver({ __ipc: "reply", channel: wire("queryRows"), id: one.id, envelope: ok(1) });
      await expect(first).resolves.toBe(1);
      await expect(second).resolves.toBe(2);
   });

   it("posts a call at once when the port is there, spreads rest arguments, and sends none for no parameters", async () => {
      const { api, arrive } = await loadPage();
      const tagged = arrive("tagged");
      const ping = arrive("ping");

      api.tagged.invoke("a", "b", "c");
      api.ping.invoke();

      expect(tagged.posted("call")[0].args).toStrictEqual(["a", "b", "c"]);
      expect(ping.posted("call")[0].args).toStrictEqual([]);
   });

   it("rejects with the error of the handler as a plain object", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("queryRows");

      const answer = api.queryRows.invoke("x");
      const [sent] = port.posted("call");
      port.deliver({
         __ipc: "reply",
         channel: wire("queryRows"),
         id: sent.id,
         envelope: {
            ok: false,
            error: { name: "QueryError", message: "no table", code: "E_QUERY", data: { sql: "x" } },
         },
      });

      const result = await settled(answer);
      expect(Object.getPrototypeOf((result as { error: object }).error)).toBe(Object.prototype);
      expect(result).toStrictEqual({
         error: { name: "QueryError", message: "no table", code: "E_QUERY", data: { sql: "x" } },
      });
   });

   it.each([
      ["a missing envelope", undefined],
      ["an envelope that is not an object", "yes"],
      ["an envelope of an unknown shape", { ok: "maybe" }],
      ["a failure without an error", { ok: false }],
   ])("rejects with IPC_UTILITY_INVALID_REPLY for %s", async (_name, envelope) => {
      const { api, arrive } = await loadPage();
      const port = arrive("queryRows");

      const answer = api.queryRows.invoke("x");
      const [sent] = port.posted("call");
      port.deliver({ __ipc: "reply", channel: wire("queryRows"), id: sent.id, envelope });

      expect(await settled(answer)).toMatchObject({
         error: { name: "IpcUtilityError", code: "IPC_UTILITY_INVALID_REPLY" },
      });
   });

   it("rejects with IPC_UTILITY_UNSENDABLE when the arguments cannot be sent, and keeps working", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("queryRows");
      port.postMessage.mockImplementationOnce(() => {
         throw new Error("could not be cloned");
      });

      const result = await settled(api.queryRows.invoke("x"));

      expect(result).toMatchObject({
         error: { name: "IpcUtilityError", code: "IPC_UTILITY_UNSENDABLE" },
      });
      expect((result as { error: Error }).error.message).toContain("could not be cloned");
      api.queryRows.invoke("y");
      expect(port.posted("call")).toHaveLength(2);
   });

   it("ignores replies it cannot trust, and keeps waiting", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("queryRows");
      const answer = api.queryRows.invoke("x");
      const [sent] = port.posted("call");

      for (const message of [
         null,
         "text",
         [],
         { __ipc: "reply", channel: wire("countRows"), id: sent.id, envelope: ok(0) },
         { __ipc: "reply", channel: wire("queryRows"), id: sent.id + 100, envelope: ok(0) },
         { __ipc: "reply", channel: wire("queryRows"), id: String(sent.id), envelope: ok(0) },
         { __ipc: "other", channel: wire("queryRows"), id: sent.id },
      ]) {
         port.deliver(message);
      }
      port.deliver({ __ipc: "reply", channel: wire("queryRows"), id: sent.id, envelope: ok(7) });

      await expect(answer).resolves.toBe(7);
   });

   it("settles a call once: a second reply with its ID is dropped", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("queryRows");
      const answer = api.queryRows.invoke("x");
      const [sent] = port.posted("call");

      port.deliver({ __ipc: "reply", channel: wire("queryRows"), id: sent.id, envelope: ok(1) });
      port.deliver({ __ipc: "reply", channel: wire("queryRows"), id: sent.id, envelope: ok(2) });

      await expect(answer).resolves.toBe(1);
   });
});

describe("utility ports, the page, the life of the connection", () => {
   it("rejects the open calls with IPC_UTILITY_EXITED when the port closes, and the later calls at once", async () => {
      const { api, arrive } = await loadPage();
      const port = arrive("queryRows");
      const open = api.queryRows.invoke("x");

      port.emitClose();

      expect(await settled(open)).toMatchObject({
         error: { name: "IpcUtilityError", code: "IPC_UTILITY_EXITED" },
      });
      expect(port.close).toHaveBeenCalledTimes(1);
      expect(await settled(api.queryRows.invoke("y"))).toMatchObject({
         error: { code: "IPC_UTILITY_EXITED" },
      });
      expect(port.postMessage).toHaveBeenCalledTimes(1);
   });

   it("ends the connection when the main process says so with the key, and ignores any other key", async () => {
      const { api, arrive, closeFromMain } = await loadPage();
      const port = arrive("queryRows", "7:utility");
      const open = api.queryRows.invoke("x");

      closeFromMain("queryRows", "8:utility");
      closeFromMain("queryRows", 7);
      expect(port.close).not.toHaveBeenCalled();

      closeFromMain("queryRows", "7:utility");
      expect(await settled(open)).toMatchObject({ error: { code: "IPC_UTILITY_EXITED" } });
      expect(port.close).toHaveBeenCalledTimes(1);
      closeFromMain("queryRows", "7:utility");
      expect(port.close).toHaveBeenCalledTimes(1);
   });

   it("works again when the main process connects a new process, after the old one went away", async () => {
      const { api, arrive } = await loadPage();
      const old = arrive("queryRows", "1:utility");
      old.emitClose();
      expect(await settled(api.queryRows.invoke("x"))).toMatchObject({
         error: { code: "IPC_UTILITY_EXITED" },
      });

      const fresh = arrive("queryRows", "2:utility");
      const answer = api.queryRows.invoke("y");
      const [sent] = fresh.posted("call");
      fresh.deliver({ __ipc: "reply", channel: wire("queryRows"), id: sent.id, envelope: ok(3) });

      await expect(answer).resolves.toBe(3);
   });

   it("replaces the port of the channel: the open calls of the old one fail, and the old port is closed", async () => {
      const { api, arrive } = await loadPage();
      const old = arrive("queryRows", "1:utility");
      const open = api.queryRows.invoke("x");

      const fresh = arrive("queryRows", "1:utility");

      expect(await settled(open)).toMatchObject({ error: { code: "IPC_UTILITY_EXITED" } });
      expect(old.close).toHaveBeenCalledTimes(1);
      // The old port can no longer fail the connection of the new one.
      old.emitClose();
      const answer = api.queryRows.invoke("y");
      const [sent] = fresh.posted("call");
      fresh.deliver({ __ipc: "reply", channel: wire("queryRows"), id: sent.id, envelope: ok(1) });
      await expect(answer).resolves.toBe(1);
   });

   it("keeps the channels apart, and closes a port which has no usable key", async () => {
      const { api, arrive } = await loadPage();
      const query = arrive("queryRows");
      const count = arrive("countRows");
      const bad = arrive("ping", 5);
      arrive("tagged", "k", null);

      query.emitClose();
      api.countRows.invoke("rows");

      expect(count.posted("call")).toHaveLength(1);
      expect(bad.close).toHaveBeenCalledTimes(1);
   });
});
