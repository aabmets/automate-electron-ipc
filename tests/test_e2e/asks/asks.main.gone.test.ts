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

import { cleanupAsks, createFrame, loadMain, questions } from "@testutils/e2e/ask-utils.js";
import { createContents } from "@testutils/e2e/fake-contents.js";
import { ok } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanupAsks);

describe("ask, main process, a target that is gone", () => {
   const gone = (channel: string) => ({
      name: "IpcAskError",
      code: "IPC_ASK_DESTROYED",
      channel,
      message: `The renderer that was asked on the channel '${channel}' is gone`,
   });

   it("rejects at once for contents that are destroyed, without sending", async () => {
      const { ipc, electron } = await loadMain();
      const contents = createContents({ id: 1, destroyed: true });

      await expect(ipc.hasUnsavedChanges.invoke(contents, 7)).rejects.toMatchObject(
         gone("hasUnsavedChanges"),
      );
      await expect(
         ipc.hasUnsavedChanges.invoke({ webContents: contents }, 7),
      ).rejects.toMatchObject(gone("hasUnsavedChanges"));
      expect(contents.send).not.toHaveBeenCalled();
      expect(electron.ipcMain.on).not.toHaveBeenCalled();
   });

   it("rejects at once when the contents cannot be inspected", async () => {
      const { ipc } = await loadMain();
      const contents = createContents({ id: 1 });
      contents.isDestroyed = () => {
         throw new Error("Object has been destroyed");
      };

      await expect(ipc.hasUnsavedChanges.invoke(contents, 7)).rejects.toMatchObject(
         gone("hasUnsavedChanges"),
      );
      expect(contents.send).not.toHaveBeenCalled();
   });

   it("rejects at once for a BrowserWindow whose webContents throws after destroy()", async () => {
      const { ipc, electron } = await loadMain();
      const contents = createContents({ id: 1 });
      const win = {
         destroyed: false,
         isDestroyed: () => win.destroyed,
         get webContents() {
            if (win.destroyed) {
               throw new TypeError("Object has been destroyed");
            }
            return contents;
         },
      };
      win.destroyed = true;

      await expect(ipc.hasUnsavedChanges.invoke(win, 7)).rejects.toMatchObject(
         gone("hasUnsavedChanges"),
      );
      expect(contents.send).not.toHaveBeenCalled();
      expect(electron.ipcMain.on).not.toHaveBeenCalled();
   });

   it("rejects at once when the webContents getter throws and isDestroyed() is not true", async () => {
      const { ipc } = await loadMain();
      const win = {
         isDestroyed: () => false,
         get webContents(): never {
            throw new TypeError("Object has been destroyed");
         },
      };

      await expect(ipc.hasUnsavedChanges.invoke(win, 7)).rejects.toMatchObject(
         gone("hasUnsavedChanges"),
      );
   });

   it.each(["destroyed", "render-process-gone"])(
      "rejects the question that waits when the contents emit '%s'",
      async (event) => {
         const { ipc, reply } = await loadMain();
         vi.useFakeTimers();
         const contents = createContents({ id: 1 });
         const answer = ipc.hasUnsavedChanges.invokeWith(contents, { timeoutMs: 5000 }, 7);
         const second = ipc.describe.invoke(contents);
         const rejected = [
            expect(answer).rejects.toMatchObject(gone("hasUnsavedChanges")),
            expect(second).rejects.toMatchObject(gone("describe")),
         ];
         const [[id]] = questions(contents.send, "hasUnsavedChanges");

         contents.emit(event);

         await Promise.all(rejected);
         expect(vi.getTimerCount()).toBe(0);
         expect(contents.listenerCount("destroyed")).toBe(0);
         expect(contents.listenerCount("render-process-gone")).toBe(0);
         expect(() => reply("hasUnsavedChanges", contents, id, ok(true))).not.toThrow();
      },
   );

   it("rejects at once for contents whose renderer crashed before the question", async () => {
      const { ipc, electron } = await loadMain();
      const contents = createContents({ id: 1, crashed: true });

      await expect(ipc.hasUnsavedChanges.invoke(contents, 7)).rejects.toMatchObject(
         gone("hasUnsavedChanges"),
      );
      await expect(
         ipc.hasUnsavedChanges.invoke({ webContents: contents }, 7),
      ).rejects.toMatchObject(gone("hasUnsavedChanges"));
      expect(contents.send).not.toHaveBeenCalled();
      expect(electron.ipcMain.on).not.toHaveBeenCalled();
   });

   it("rejects at once for a frame of contents whose renderer crashed", async () => {
      const contents = createContents({ id: 1, crashed: true });
      const { ipc } = await loadMain("ask-channels", () => contents);
      const frame = createFrame({ processId: 4, routingId: 10 });

      await expect(ipc.hasUnsavedChanges.invoke(frame, 7)).rejects.toMatchObject(
         gone("hasUnsavedChanges"),
      );
      expect(frame.send).not.toHaveBeenCalled();
   });

   it("asks contents which are alive again after a crash", async () => {
      const { ipc, reply } = await loadMain();
      const contents = createContents({ id: 1, crashed: true });
      contents.crashed = false;

      const answer = ipc.hasUnsavedChanges.invoke(contents, 7);
      const [[id]] = questions(contents.send, "hasUnsavedChanges");
      reply("hasUnsavedChanges", contents, id, ok(true));

      await expect(answer).resolves.toBe(true);
   });

   it("lets go of the contents once the question is answered", async () => {
      const { ipc, reply } = await loadMain();
      const contents = createContents({ id: 1 });

      const answer = ipc.hasUnsavedChanges.invoke(contents, 7);
      expect(contents.listenerCount("destroyed")).toBe(1);
      expect(contents.listenerCount("did-navigate")).toBe(1);
      const [[id]] = questions(contents.send, "hasUnsavedChanges");
      reply("hasUnsavedChanges", contents, id, ok(true));

      await answer;
      expect(contents.listenerCount("destroyed")).toBe(0);
      expect(contents.listenerCount("render-process-gone")).toBe(0);
      expect(contents.listenerCount("did-navigate")).toBe(0);
   });

   // Node warns about more than ten listeners of one event (T87).
   it("keeps one listener per event on the contents, however many questions are pending", async () => {
      const { ipc, reply } = await loadMain();
      const contents = createContents({ id: 1 });

      const answers = Array.from({ length: 12 }, (_, n) =>
         ipc.hasUnsavedChanges.invoke(contents, n),
      );
      const ids = questions(contents.send, "hasUnsavedChanges").map(([id]) => id);

      expect(ids).toHaveLength(12);
      for (const event of ["destroyed", "render-process-gone", "did-navigate"]) {
         expect(contents.listenerCount(event)).toBe(1);
      }
      expect(contents.listenerCount("did-frame-navigate")).toBe(0);
      // The first ten answer, and the rest are still watched.
      for (const id of ids.slice(0, 10)) {
         reply("hasUnsavedChanges", contents, id, ok(true));
      }
      expect(contents.listenerCount("destroyed")).toBe(1);
      for (const id of ids.slice(10)) {
         reply("hasUnsavedChanges", contents, id, ok(true));
      }
      await expect(Promise.all(answers)).resolves.toHaveLength(12);
      for (const event of ["destroyed", "render-process-gone", "did-navigate"]) {
         expect(contents.listenerCount(event)).toBe(0);
      }
   });

   it("settles every pending question when the contents go away, with one listener", async () => {
      const { ipc } = await loadMain();
      const contents = createContents({ id: 1 });

      const answers = Array.from({ length: 12 }, (_, n) =>
         ipc.hasUnsavedChanges.invoke(contents, n).then(
            () => "answered",
            (error: { code: string }) => error.code,
         ),
      );
      contents.emit("render-process-gone");

      await expect(Promise.all(answers)).resolves.toStrictEqual(
         Array.from({ length: 12 }, () => "IPC_ASK_DESTROYED"),
      );
      for (const event of ["destroyed", "render-process-gone", "did-navigate"]) {
         expect(contents.listenerCount(event)).toBe(0);
      }
   });

   it("keeps one listener of the commit for the questions of the frames of one contents", async () => {
      const frames = [1, 2, 3].map((routingId) => createFrame({ processId: 4, routingId }));
      const contents = createContents({ id: 1 });
      const { ipc, reply } = await loadMain("ask-channels", () => contents);

      const answers = frames.map((frame) => ipc.hasUnsavedChanges.invoke(frame as any, 1));

      expect(contents.listenerCount("did-frame-navigate")).toBe(1);
      expect(contents.listenerCount("did-navigate")).toBe(0);
      // A navigation of the second frame ends only its question.
      contents.emit("did-frame-navigate", {}, "app://main/x", 200, "OK", false, 4, 2);
      await expect(answers[1]).rejects.toMatchObject({ code: "IPC_ASK_DESTROYED" });
      expect(contents.listenerCount("did-frame-navigate")).toBe(1);
      for (const [index, frame] of frames.entries()) {
         if (index !== 1) {
            const [[id]] = questions(frame.send, "hasUnsavedChanges");
            reply("hasUnsavedChanges", contents, id, ok(true), frame);
         }
      }
      await expect(Promise.all([answers[0], answers[2]])).resolves.toStrictEqual([true, true]);
      expect(contents.listenerCount("did-frame-navigate")).toBe(0);
   });

   it("rejects with the error of the send, and leaves nothing behind", async () => {
      const { ipc, reply } = await loadMain();
      vi.useFakeTimers();
      const contents = createContents({ id: 1 });
      contents.send.mockImplementation(() => {
         throw new Error("An object could not be cloned.");
      });

      const answer = ipc.hasUnsavedChanges.invokeWith(contents, { timeoutMs: 5000 }, 7);

      await expect(answer).rejects.toThrowError("An object could not be cloned.");
      expect(vi.getTimerCount()).toBe(0);
      expect(contents.listenerCount("destroyed")).toBe(0);
      const [[id]] = questions(contents.send, "hasUnsavedChanges");
      expect(() => reply("hasUnsavedChanges", contents, id, ok(true))).not.toThrow();
   });
});
