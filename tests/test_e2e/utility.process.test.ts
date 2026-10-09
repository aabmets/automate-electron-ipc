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

import {
   createParentPort,
   failed,
   flush,
   load,
   ok,
   resetUtilityFakes,
   wire,
} from "@testutils/utility-process-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
   await resetUtilityFakes();
});

describe("utility channels, utility process, handling the calls of the main process", () => {
   it("calls the handler with the arguments, and replies with the envelope", async () => {
      const { utility } = await load();
      const { posted, emitFromMain } = createParentPort();
      const handler = vi.fn(async (path: string) => path.length);
      utility.ipc.indexFile.handle(handler);

      emitFromMain({ __ipc: "call", channel: wire("indexFile"), id: 3, args: ["/tmp"] });
      await flush();

      expect(handler).toHaveBeenCalledWith("/tmp");
      expect(posted("reply")).toStrictEqual([
         { __ipc: "reply", channel: wire("indexFile"), id: 3, envelope: ok(4) },
      ]);
   });

   it("replies with a value of a synchronous handler, and spreads the rest arguments", async () => {
      const { utility } = await load();
      const { posted, emitFromMain } = createParentPort();
      utility.ipc.runJob.handle((job: { id: number }, ...tags: string[]) => ({
         files: job.id + tags.length,
      }));

      emitFromMain({ __ipc: "call", channel: wire("runJob"), id: 1, args: [{ id: 10 }, "a", "b"] });
      await flush();

      expect(posted("reply")[0].envelope).toStrictEqual(ok({ files: 12 }));
   });

   it("replies with the error of a handler which throws", async () => {
      const { utility } = await load();
      const { posted, emitFromMain } = createParentPort();
      utility.ipc.indexFile.handle(() => {
         throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      });

      emitFromMain({ __ipc: "call", channel: wire("indexFile"), id: 1, args: ["a"] });
      await flush();

      expect(posted("reply")[0].envelope).toStrictEqual(
         failed({ name: "Error", message: "disk full", code: "ENOSPC" }),
      );
   });

   it("replies with IPC_UTILITY_NO_HANDLER for a channel without a handler, and after the disposer", async () => {
      const { utility } = await load();
      const { posted, emitFromMain } = createParentPort();
      const remove = utility.ipc.indexFile.handle(async () => 1);
      remove();

      emitFromMain({ __ipc: "call", channel: wire("indexFile"), id: 1, args: ["a"] });
      emitFromMain({ __ipc: "call", channel: wire("reset"), id: 2, args: [] });
      await flush();

      expect(posted("reply").map((reply) => (reply.envelope as any).error.code)).toStrictEqual([
         "IPC_UTILITY_NO_HANDLER",
         "IPC_UTILITY_NO_HANDLER",
      ]);
   });

   it("registers one listener on the port, however many channels are used", async () => {
      const { utility } = await load();
      const { port } = createParentPort();

      utility.ipc.indexFile.handle(async () => 1);
      utility.ipc.pause.on(() => undefined);
      utility.ipc.getSetting.invoke("a");

      expect(port.listenerCount("message")).toBe(1);
   });

   it("replies with IPC_UTILITY_UNSENDABLE when the result cannot be posted", async () => {
      const { utility } = await load();
      const { port, posted, emitFromMain } = createParentPort();
      utility.ipc.indexFile.handle(async () => 1);
      port.postMessage.mockImplementationOnce(() => {
         throw new Error("An object could not be cloned.");
      });

      emitFromMain({ __ipc: "call", channel: wire("indexFile"), id: 1, args: ["a"] });
      await flush();

      expect((posted("reply")[1].envelope as any).error.code).toBe("IPC_UTILITY_UNSENDABLE");
   });
});

describe("utility channels, utility process, notifications and calls to the main process", () => {
   it("calls the listeners of a notification, and a once listener one time", async () => {
      const { utility } = await load();
      const { emitFromMain } = createParentPort();
      const on = vi.fn();
      const once = vi.fn();
      utility.ipc.setLogLevel.on(on);
      utility.ipc.setLogLevel.once(once);
      const message = { __ipc: "send", channel: wire("setLogLevel"), args: ["debug"] };

      emitFromMain(message);
      emitFromMain(message);

      expect(on).toHaveBeenCalledTimes(2);
      expect(on).toHaveBeenCalledWith("debug");
      expect(once).toHaveBeenCalledOnce();
   });

   it("posts a one-way message with the arguments", async () => {
      const { utility } = await load();
      const { posted } = createParentPort();

      utility.ipc.progress.send(1, 2);
      utility.ipc.jobDone.send({ id: 1, path: "a" });

      expect(posted("send", "progress")[0].args).toStrictEqual([1, 2]);
      expect(posted("send", "jobDone")[0].args).toStrictEqual([{ id: 1, path: "a" }]);
   });

   it("posts the call with an ID, and resolves with the answer or rejects with the error", async () => {
      const { utility } = await load();
      const { posted, emitFromMain } = createParentPort();

      const found = utility.ipc.getSetting.invoke("theme");
      const missing = utility.ipc.getSetting.invoke("missing", "none");
      const [one, two] = posted("call", "getSetting");
      expect(one.args).toStrictEqual(["theme", undefined]);
      expect(two.args).toStrictEqual(["missing", "none"]);
      emitFromMain({
         __ipc: "reply",
         channel: wire("getSetting"),
         id: one.id,
         envelope: ok("dark"),
      });
      emitFromMain({
         __ipc: "reply",
         channel: wire("getSetting"),
         id: two.id,
         envelope: failed({ name: "KeyError", message: "unknown key", code: "E_KEY" }),
      });

      await expect(found).resolves.toBe("dark");
      const error = await missing.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(utility.IpcUtilityError);
      expect(error).toMatchObject({ name: "KeyError", message: "unknown key", code: "E_KEY" });
   });

   it("rejects with IPC_UTILITY_UNSENDABLE when the arguments cannot be posted", async () => {
      const { utility } = await load();
      const { port } = createParentPort();
      port.postMessage.mockImplementation(() => {
         throw new Error("An object could not be cloned.");
      });

      await expect(utility.ipc.getSetting.invoke("a")).rejects.toMatchObject({
         code: "IPC_UTILITY_UNSENDABLE",
      });
      expect(() => utility.ipc.progress.send(1, 2)).toThrow(
         expect.objectContaining({ code: "IPC_UTILITY_UNSENDABLE" }),
      );
   });

   it("fails with a clear error outside a utility process, and can still be imported there", async () => {
      const { utility } = await load();

      expect(() => utility.ipc.progress.send(1, 2)).toThrow(/only in an Electron utility process/);
      expect(() => utility.ipc.indexFile.handle(async () => 1)).toThrow(TypeError);

      // The port appears later in the same process: nothing was cached from the failed attempts.
      const { posted } = createParentPort();
      utility.ipc.progress.send(1, 2);
      expect(posted("send", "progress")).toHaveLength(1);
   });
});
