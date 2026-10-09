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
   flush,
   load,
   ok,
   resetUtilityFakes,
   wire,
} from "@testutils/utility-process-utils.js";
import { afterEach, describe, expect, it } from "vitest";

afterEach(async () => {
   await resetUtilityFakes();
});

describe("utility channels, main process, calling the child", () => {
   it("settles a call once: a second reply is dropped", async () => {
      const { main } = await load();
      const { child, posted, emitFromChild } = createChild();

      const answer = main.ipc.indexFile.invoke(child, "a");
      const [call] = posted("call", "indexFile");
      const reply = (value: number) =>
         emitFromChild({
            __ipc: "reply",
            channel: wire("indexFile"),
            id: call.id,
            envelope: ok(value),
         });
      reply(1);
      reply(2);

      await expect(answer).resolves.toBe(1);
   });

   it("rejects every pending call when the child exits, and the later calls and sends", async () => {
      const { main } = await load();
      const { child } = createChild();

      const first = main.ipc.indexFile.invoke(child, "a");
      const second = main.ipc.reset.invoke(child);
      child.emit("exit", 1);

      await expect(first).rejects.toMatchObject({
         name: "IpcUtilityError",
         code: "IPC_UTILITY_EXITED",
         channel: wire("indexFile"),
      });
      await expect(first).rejects.toThrow(
         "The utility process exited before the channel 'autoipc:indexFile' was answered",
      );
      await expect(second).rejects.toMatchObject({
         code: "IPC_UTILITY_EXITED",
         channel: wire("reset"),
      });

      await expect(main.ipc.indexFile.invoke(child, "b")).rejects.toMatchObject({
         code: "IPC_UTILITY_EXITED",
      });
      expect(() => main.ipc.pause.send(child)).toThrow(main.IpcUtilityError);
      expect(child.postMessage).toHaveBeenCalledTimes(2);
   });

   it("rejects a call to a child that exited right after it was attached, and fails the sends", async () => {
      const { main } = await load();
      const { child } = createChild();
      child.emit("exit", 0);

      await expect(main.ipc.indexFile.invoke(child, "a")).rejects.toMatchObject({
         name: "IpcUtilityError",
         code: "IPC_UTILITY_EXITED",
         channel: wire("indexFile"),
      });
      expect(() => main.ipc.pause.send(child)).toThrow(
         expect.objectContaining({ code: "IPC_UTILITY_EXITED" }),
      );
      expect(child.postMessage).not.toHaveBeenCalled();
   });

   it("does not answer a call from the child after it exited, and a second exit changes nothing", async () => {
      const { main } = await load();
      const { child, emitFromChild } = createChild();
      main.ipc.getSetting.handle(child, async () => "x");

      child.emit("exit", 0);
      emitFromChild({ __ipc: "call", channel: wire("getSetting"), id: 1, args: ["a"] });
      await flush();

      expect(child.postMessage).not.toHaveBeenCalled();
      expect(() => child.emit("exit", 0)).not.toThrow();
   });

   it("keeps calls to one child apart from another child", async () => {
      const { main } = await load();
      const one = createChild();
      const two = createChild();

      const first = main.ipc.indexFile.invoke(one.child, "a");
      const second = main.ipc.indexFile.invoke(two.child, "b");
      two.child.emit("exit", 1);

      await expect(second).rejects.toMatchObject({ code: "IPC_UTILITY_EXITED" });
      const [call] = one.posted("call", "indexFile");
      one.emitFromChild({
         __ipc: "reply",
         channel: wire("indexFile"),
         id: call.id,
         envelope: ok(5),
      });
      await expect(first).resolves.toBe(5);
   });

   it("rejects with IPC_UTILITY_UNSENDABLE when the arguments cannot be posted", async () => {
      const { main } = await load();
      const { child } = createChild();
      child.postMessage.mockImplementation(() => {
         throw new Error("An object could not be cloned.");
      });

      const answer = main.ipc.indexFile.invoke(child, "a");

      await expect(answer).rejects.toMatchObject({
         code: "IPC_UTILITY_UNSENDABLE",
         channel: wire("indexFile"),
      });
      await expect(answer).rejects.toThrow("An object could not be cloned.");
      // The call is not left pending, so an exit rejects nothing more.
      expect(() => child.emit("exit", 1)).not.toThrow();
   });

   it("describes a thing which is thrown but is not an error", async () => {
      const { main } = await load();
      const { child } = createChild();
      child.postMessage.mockImplementation(() => {
         // biome-ignore lint/style/useThrowOnlyError: a value which is not an error is the case under test
         throw "plain text";
      });

      await expect(main.ipc.indexFile.invoke(child, "a")).rejects.toThrow("plain text");
   });
});

describe("utility channels, main process, notifying the child", () => {
   it("posts a one-way message with the arguments", async () => {
      const { main } = await load();
      const { child, posted } = createChild();

      expect(main.ipc.setLogLevel.send(child, "debug")).toBeUndefined();
      main.ipc.pause.send(child);

      expect(posted("send", "setLogLevel")).toStrictEqual([
         { __ipc: "send", channel: wire("setLogLevel"), args: ["debug"] },
      ]);
      expect(posted("send", "pause")[0].args).toStrictEqual([]);
   });

   it("throws IPC_UTILITY_UNSENDABLE when the message cannot be posted", async () => {
      const { main } = await load();
      const { child } = createChild();
      child.postMessage.mockImplementation(() => {
         throw new Error("cannot clone");
      });

      expect(() => main.ipc.setLogLevel.send(child, "debug")).toThrow(
         expect.objectContaining({ code: "IPC_UTILITY_UNSENDABLE" }),
      );
   });
});
