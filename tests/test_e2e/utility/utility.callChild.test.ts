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

import { createChild, load, resetUtilityFakes } from "@testutils/e2e/utility-process-utils.js";
import { failed, ok, wire } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
   resetUtilityFakes();
});

describe("utility channels, main process, calling the child", () => {
   it("posts the call with an ID, and resolves with the answer", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();

      const answer = main.ipc.indexFile.invoke(child, "/tmp");

      const [call] = posted("call", "indexFile");
      expect(call).toStrictEqual({
         __ipc: "call",
         channel: wire("indexFile"),
         id: expect.any(Number),
         args: ["/tmp"],
      });
      emitFromChild({ __ipc: "reply", channel: wire("indexFile"), id: call.id, envelope: ok(3) });
      await expect(answer).resolves.toBe(3);
   });

   it("spreads rest arguments, and sends none for a signature without parameters", async () => {
      const { main } = await load();
      const { child, posted } = createChild();

      main.ipc.runJob.invoke(child, { id: 1, path: "a" }, "x", "y");
      main.ipc.reset.invoke(child);

      expect(posted("call", "runJob")[0].args).toStrictEqual([{ id: 1, path: "a" }, "x", "y"]);
      expect(posted("call", "reset")[0].args).toStrictEqual([]);
   });

   it("answers concurrent calls by their IDs, in any order", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();

      const first = main.ipc.indexFile.invoke(child, "a");
      const second = main.ipc.indexFile.invoke(child, "b");
      const [one, two] = posted("call", "indexFile");
      expect(one.id).not.toBe(two.id);
      emitFromChild({ __ipc: "reply", channel: wire("indexFile"), id: two.id, envelope: ok(2) });
      emitFromChild({ __ipc: "reply", channel: wire("indexFile"), id: one.id, envelope: ok(1) });

      await expect(first).resolves.toBe(1);
      await expect(second).resolves.toBe(2);
   });

   it("rejects with an IpcUtilityError which carries what the handler threw", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();

      const answer = main.ipc.indexFile.invoke(child, "/missing");
      const [call] = posted("call", "indexFile");
      emitFromChild({
         __ipc: "reply",
         channel: wire("indexFile"),
         id: call.id,
         envelope: failed({
            name: "NotFound",
            message: "No such file",
            code: "ENOENT",
            data: { a: 1 },
         }),
      });

      const error = await answer.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(main.IpcUtilityError);
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
         name: "NotFound",
         message: "No such file",
         code: "ENOENT",
         data: { a: 1 },
         channel: wire("indexFile"),
      });
   });

   it.each([
      ["a missing envelope", undefined],
      ["an envelope that is not an object", "yes"],
      ["an envelope of an unknown shape", { ok: "maybe" }],
      ["a failure without an error", { ok: false }],
   ])("rejects with IPC_UTILITY_INVALID_REPLY for %s", async (_name, envelope) => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();

      const answer = main.ipc.indexFile.invoke(child, "a");
      const [call] = posted("call", "indexFile");
      emitFromChild({ __ipc: "reply", channel: wire("indexFile"), id: call.id, envelope });

      await expect(answer).rejects.toMatchObject({ code: "IPC_UTILITY_INVALID_REPLY" });
   });

   it("reads a failure with unusual fields as an error with defaults", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();

      const answer = main.ipc.indexFile.invoke(child, "a");
      const [call] = posted("call", "indexFile");
      emitFromChild({
         __ipc: "reply",
         channel: wire("indexFile"),
         id: call.id,
         envelope: failed({ name: "", message: 5, code: {} }),
      });

      const error = await answer.catch((caught: unknown) => caught);
      expect(error).toMatchObject({ name: "Error", code: undefined });
      expect((error as Error).message).toBe("The other side failed without a message");
   });

   it("ignores replies it cannot trust, and keeps waiting", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();
      const other = createChild();

      const answer = main.ipc.indexFile.invoke(child, "a");
      const [call] = posted("call", "indexFile");
      // The wrong channel, an ID which is not pending, an ID of another type, and another child.
      emitFromChild({ __ipc: "reply", channel: wire("runJob"), id: call.id, envelope: ok(0) });
      emitFromChild({
         __ipc: "reply",
         channel: wire("indexFile"),
         id: call.id + 100,
         envelope: ok(0),
      });
      emitFromChild({
         __ipc: "reply",
         channel: wire("indexFile"),
         id: String(call.id),
         envelope: ok(0),
      });
      other.emitFromChild({
         __ipc: "reply",
         channel: wire("indexFile"),
         id: call.id,
         envelope: ok(0),
      });
      // Messages which are not the library's, and are left to the application.
      for (const message of [
         null,
         undefined,
         7,
         "text",
         [],
         { type: "other" },
         { __ipc: 1 },
         { __ipc: "reply" },
      ]) {
         emitFromChild(message);
      }
      emitFromChild({ __ipc: "reply", channel: wire("indexFile"), id: call.id, envelope: ok(9) });

      await expect(answer).resolves.toBe(9);
   });
});
