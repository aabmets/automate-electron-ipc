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
   cleanupAsks,
   createContents,
   createFrame,
   loadMain,
   ok,
   questions,
} from "@testutils/ask-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanupAsks);

describe("ask, main process, errors of the renderer", () => {
   it("rejects with an IpcAskError which carries the name, message, code and data", async () => {
      const { ipc, IpcAskError, reply } = await loadMain();
      const contents = createContents(1);

      const answer = ipc.hasUnsavedChanges.invoke(contents, 7);
      const [[id]] = questions(contents.send, "hasUnsavedChanges");
      reply("hasUnsavedChanges", contents, id, {
         ok: false,
         error: {
            name: "NotFoundError",
            message: "no document 7",
            code: "NOT_FOUND",
            data: { id: 7 },
         },
      });

      const error = await answer.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(IpcAskError);
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
         name: "NotFoundError",
         message: "no document 7",
         code: "NOT_FOUND",
         data: { id: 7 },
         channel: "hasUnsavedChanges",
      });
   });

   it("rejects with the code that the preload script gives when no responder is registered", async () => {
      const { ipc, reply } = await loadMain();
      const contents = createContents(1);

      const answer = ipc.hasUnsavedChanges.invoke(contents, 7);
      const [[id]] = questions(contents.send, "hasUnsavedChanges");
      reply("hasUnsavedChanges", contents, id, {
         ok: false,
         error: {
            name: "IpcAskError",
            message: "No handler is registered for the channel 'hasUnsavedChanges'",
            code: "IPC_ASK_NO_HANDLER",
         },
      });

      await expect(answer).rejects.toMatchObject({
         name: "IpcAskError",
         code: "IPC_ASK_NO_HANDLER",
         message: "No handler is registered for the channel 'hasUnsavedChanges'",
      });
   });

   it.each([
      [{ message: "boom" }, { name: "Error", message: "boom", code: undefined }],
      [
         { name: "", message: "boom", code: 5 },
         { name: "Error", message: "boom", code: 5 },
      ],
      [
         { name: "E", code: { nested: true } },
         { name: "E", code: undefined },
      ],
      [
         { name: 5, message: 6 },
         { name: "Error", message: "The renderer failed without a message" },
      ],
   ])("reads the error %j defensively", async (error, expected) => {
      const { ipc, reply } = await loadMain();
      const contents = createContents(1);

      const answer = ipc.hasUnsavedChanges.invoke(contents, 7);
      const [[id]] = questions(contents.send, "hasUnsavedChanges");
      reply("hasUnsavedChanges", contents, id, { ok: false, error });

      await expect(answer).rejects.toMatchObject(expected);
   });

   it.each([
      undefined,
      null,
      "yes",
      5,
      {},
      { ok: 1, value: true },
      { ok: false },
      { ok: false, error: null },
      { ok: false, error: "boom" },
   ])("rejects an unreadable reply %j", async (envelope) => {
      const { ipc, reply } = await loadMain();
      const contents = createContents(1);

      const answer = ipc.hasUnsavedChanges.invoke(contents, 7);
      const [[id]] = questions(contents.send, "hasUnsavedChanges");
      reply("hasUnsavedChanges", contents, id, envelope);

      await expect(answer).rejects.toMatchObject({
         name: "IpcAskError",
         code: "IPC_ASK_INVALID_REPLY",
      });
   });
});

describe("ask, main process, frames", () => {
   it("sends to the frame itself, and takes the answer of that frame only", async () => {
      const contents = createContents(1);
      const { ipc, reply } = await loadMain("ask-channels", () => contents);
      const frame = createFrame({ processId: 4, routingId: 10 });
      const sibling = createFrame({ processId: 4, routingId: 11 });

      const answer = ipc.hasUnsavedChanges.invoke(frame, 7);

      expect(contents.send).not.toHaveBeenCalled();
      const [[id, ...args]] = questions(frame.send, "hasUnsavedChanges");
      expect(args).toStrictEqual([7]);
      const settled = vi.fn();
      answer.then(settled, settled);
      reply("hasUnsavedChanges", contents, id, ok("sibling"), sibling);
      reply("hasUnsavedChanges", contents, id, ok("no frame"), null);
      reply("hasUnsavedChanges", createContents(2), id, ok("other contents"), frame);
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();

      reply("hasUnsavedChanges", contents, id, ok("frame"), frame);
      await expect(answer).resolves.toBe("frame");
   });

   it("recognises the frame by its process and routing IDs, not by the object", async () => {
      const contents = createContents(1);
      const { ipc, reply } = await loadMain("ask-channels", () => contents);
      const frame = createFrame({ processId: 4, routingId: 10 });

      const answer = ipc.hasUnsavedChanges.invoke(frame, 7);
      const [[id]] = questions(frame.send, "hasUnsavedChanges");
      reply("hasUnsavedChanges", contents, id, ok("same frame"), { processId: 4, routingId: 10 });

      await expect(answer).resolves.toBe("same frame");
   });

   it("rejects the question of a frame when its contents are destroyed", async () => {
      const contents = createContents(1);
      const { ipc } = await loadMain("ask-channels", () => contents);
      const frame = createFrame({ processId: 4, routingId: 10 });

      const answer = ipc.hasUnsavedChanges.invoke(frame, 7);
      contents.emit("destroyed");

      await expect(answer).rejects.toMatchObject({ code: "IPC_ASK_DESTROYED" });
   });

   it("rejects at once for a frame that is destroyed or detached", async () => {
      const { ipc } = await loadMain();
      const destroyed = createFrame({ processId: 4, routingId: 10 }, { destroyed: true });
      const detached = createFrame({ processId: 4, routingId: 11 }, { detached: true });

      await expect(ipc.hasUnsavedChanges.invoke(destroyed, 7)).rejects.toMatchObject({
         code: "IPC_ASK_DESTROYED",
      });
      await expect(ipc.hasUnsavedChanges.invoke(detached, 7)).rejects.toMatchObject({
         code: "IPC_ASK_DESTROYED",
      });
      expect(destroyed.send).not.toHaveBeenCalled();
      expect(detached.send).not.toHaveBeenCalled();
   });

   it("still works when Electron does not know the contents of the frame", async () => {
      const { ipc, reply } = await loadMain();
      const frame = createFrame({ processId: 4, routingId: 10 });

      const answer = ipc.hasUnsavedChanges.invoke(frame, 7);
      const [[id]] = questions(frame.send, "hasUnsavedChanges");
      reply("hasUnsavedChanges", createContents(9), id, ok("frame"), frame);

      await expect(answer).resolves.toBe("frame");
   });

   it("ignores a reply from a frame whose IDs cannot be read", async () => {
      const { ipc, reply } = await loadMain();
      const frame = createFrame({ processId: 4, routingId: 10 });
      const answer = ipc.hasUnsavedChanges.invoke(frame, 7);
      const [[id]] = questions(frame.send, "hasUnsavedChanges");
      const settled = vi.fn();
      answer.then(settled, settled);
      const broken = {
         get processId(): number {
            throw new Error("Render frame was disposed");
         },
      };

      reply("hasUnsavedChanges", createContents(9), id, ok("broken"), broken);
      await Promise.resolve();

      expect(settled).not.toHaveBeenCalled();
   });
});
