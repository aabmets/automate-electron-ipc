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
   createChild,
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

describe("utility channels, main process, handling the calls of the child", () => {
   it("calls the handler with the arguments, and replies with the envelope", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();
      const handler = vi.fn(async (key: string, fallback?: string) => `${key}:${fallback}`);
      main.ipc.getSetting.handle(child, handler);

      emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 4, args: ["theme", "dark"] });
      await flush();

      expect(handler).toHaveBeenCalledWith("theme", "dark");
      expect(posted("reply")).toStrictEqual([
         { __ipc: "reply", channel: wire("getSetting"), id: 4, envelope: ok("theme:dark") },
      ]);
   });

   it("replies with the error of a handler which throws, without its stack", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();
      main.ipc.getSetting.handle(child, () => {
         throw Object.assign(new RangeError("out of range"), { code: 7, data: { at: 1 } });
      });

      emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 1, args: ["k"] });
      await flush();

      expect(posted("reply")[0].envelope).toStrictEqual(
         failed({ name: "RangeError", message: "out of range", code: 7, data: { at: 1 } }),
      );
   });

   it("replies with IPC_UTILITY_NO_HANDLER when no handler is registered", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();
      main.ipc.getSetting.handle(child, async () => "x");

      emitFromChild({ __ipc: "call", channel: wire("report"), id: 2, args: [{ files: 1 }] });
      await flush();

      expect(posted("reply")[0]).toMatchObject({
         id: 2,
         channel: wire("report"),
         envelope: failed({
            name: "IpcUtilityError",
            message: "The other side has no handler for the channel 'autoipc:report'",
            code: "IPC_UTILITY_NO_HANDLER",
         }),
      });
   });

   it("answers a child which calls before any channel has used it, once attached", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild({ attached: false });

      main.attachUtility(child);
      main.attachUtility(child);
      emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 1, args: ["k"] });
      await flush();

      expect(child.listenerCount("message")).toBe(1);
      expect(posted("reply")[0].envelope).toMatchObject({ ok: false });
   });

   it("keeps the handlers of two children apart", async () => {
      const { main } = await load();
      const one = createChild();
      const two = createChild();
      main.ipc.getSetting.handle(one.child, async () => "one");
      main.ipc.getSetting.handle(two.child, async () => "two");

      one.emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 1, args: ["k"] });
      two.emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 1, args: ["k"] });
      await flush();

      expect(one.posted("reply")[0].envelope).toStrictEqual(ok("one"));
      expect(two.posted("reply")[0].envelope).toStrictEqual(ok("two"));
   });

   it("replaces a handler, and a disposer removes only its own handler", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();
      const removeFirst = main.ipc.getSetting.handle(child, async () => "first");
      const removeSecond = main.ipc.getSetting.handle(child, async () => "second");
      const call = (id: number) =>
         emitFromChild({ __ipc: "call", channel: wire("getSetting"), id, args: ["k"] });

      call(1);
      removeFirst();
      call(2);
      await flush();
      expect(posted("reply").map((reply) => reply.envelope)).toStrictEqual([
         ok("second"),
         ok("second"),
      ]);

      removeSecond();
      call(3);
      await flush();
      expect(posted("reply")[2].envelope).toMatchObject({
         ok: false,
         error: { code: "IPC_UTILITY_NO_HANDLER" },
      });
   });

   it("replies with IPC_UTILITY_UNSENDABLE when the result cannot be posted", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();
      main.ipc.getSetting.handle(child, async () => "x");
      child.postMessage.mockImplementationOnce(() => {
         throw new Error("An object could not be cloned.");
      });

      emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 1, args: ["k"] });
      await flush();

      expect(posted("reply")[1]).toStrictEqual({
         __ipc: "reply",
         channel: wire("getSetting"),
         id: 1,
         envelope: failed({
            name: "IpcUtilityError",
            message:
               "A message of the channel 'autoipc:getSetting' cannot be sent: An object could not be cloned.",
            code: "IPC_UTILITY_UNSENDABLE",
         }),
      });
   });

   it("logs, and does not throw, when even the failure cannot be posted", async () => {
      const { main } = await load();
      const { child, emitFromChild } = createChild();
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      main.ipc.getSetting.handle(child, async () => "x");
      child.postMessage.mockImplementation(() => {
         throw new Error("the port is closed");
      });

      emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 1, args: ["k"] });
      await flush();

      expect(log).toHaveBeenCalledOnce();
   });

   it.each([
      ["an ID which is not a number", { id: "1", args: [] }],
      ["no ID", { args: [] }],
      ["arguments which are not an array", { id: 1, args: "x" }],
   ])("drops a call with %s", async (_name, fields) => {
      const { main } = await load();
      const { child, emitFromChild } = createChild();
      const handler = vi.fn(async () => "x");
      main.ipc.getSetting.handle(child, handler);

      emitFromChild({ __ipc: "call", channel: wire("getSetting"), ...fields });
      await flush();

      expect(handler).not.toHaveBeenCalled();
      expect(child.postMessage).not.toHaveBeenCalled();
   });
});

describe("utility channels, main process, listening to the child", () => {
   it("calls the listeners of the child which sent the message, in order", async () => {
      const { main } = await load();
      const one = createChild();
      const two = createChild();
      const seen: string[] = [];
      main.ipc.progress.on(one.child, (done: number, total: number) =>
         seen.push(`a${done}/${total}`),
      );
      main.ipc.progress.on(one.child, (done: number) => seen.push(`b${done}`));
      main.ipc.progress.on(two.child, (done: number) => seen.push(`other${done}`));

      one.emitFromChild({ __ipc: "send", channel: wire("progress"), args: [1, 4] });

      expect(seen).toStrictEqual(["a1/4", "b1"]);
   });

   it("removes a listener with its disposer, and the same callback can be added twice", async () => {
      const { main } = await load();
      const { child, emitFromChild } = createChild();
      const callback = vi.fn();
      const removeFirst = main.ipc.progress.on(child, callback);
      main.ipc.progress.on(child, callback);
      const message = { __ipc: "send", channel: wire("progress"), args: [1, 2] };

      emitFromChild(message);
      expect(callback).toHaveBeenCalledTimes(2);
      removeFirst();
      removeFirst();
      emitFromChild(message);
      expect(callback).toHaveBeenCalledTimes(3);
   });

   it("calls a once listener one time, and not after its disposer ran", async () => {
      const { main } = await load();
      const { child, emitFromChild } = createChild();
      const used = vi.fn();
      const removed = vi.fn();
      main.ipc.progress.once(child, used);
      main.ipc.progress.once(child, removed)();
      const message = { __ipc: "send", channel: wire("progress"), args: [1, 2] };

      emitFromChild(message);
      emitFromChild(message);

      expect(used).toHaveBeenCalledOnce();
      expect(removed).not.toHaveBeenCalled();
   });

   it("reports a listener which throws or rejects, and still calls the others", async () => {
      const { main } = await load();
      const { child, emitFromChild } = createChild();
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const after = vi.fn();
      main.ipc.progress.on(child, () => {
         throw new Error("sync failure");
      });
      main.ipc.progress.on(child, () => Promise.reject(new Error("async failure")));
      main.ipc.progress.on(child, after);

      emitFromChild({ __ipc: "send", channel: wire("progress"), args: [1, 2] });
      await flush();

      expect(after).toHaveBeenCalledOnce();
      expect(log.mock.calls.map(([error]) => (error as Error).message).sort()).toStrictEqual([
         "async failure",
         "sync failure",
      ]);
   });

   it("ignores a message of another channel and one whose arguments are not an array", async () => {
      const { main } = await load();
      const { child, emitFromChild } = createChild();
      const callback = vi.fn();
      main.ipc.progress.on(child, callback);

      emitFromChild({ __ipc: "send", channel: wire("jobDone"), args: [1, 2] });
      emitFromChild({ __ipc: "send", channel: wire("progress"), args: "12" });
      emitFromChild({ __ipc: "send", channel: wire("progress") });

      expect(callback).not.toHaveBeenCalled();
   });
});
