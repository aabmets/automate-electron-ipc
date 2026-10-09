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
   type FakeContents,
   loadMain,
   questions,
} from "@testutils/e2e/ask-utils.js";
import { ok } from "@testutils/e2e/wire-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanupAsks);

describe("ask, main process, a page which is replaced", () => {
   const gone = { name: "IpcAskError", code: "IPC_ASK_DESTROYED" };
   // The contents live on across a navigation, so no 'destroyed' and no 'render-process-gone'.
   const navigate = (contents: FakeContents) =>
      contents.emit("did-navigate", {}, "app://main/other.html", 200, "OK");
   const frameNavigate = (
      contents: FakeContents,
      isMainFrame: boolean,
      frameProcessId: number,
      frameRoutingId: number,
   ) =>
      contents.emit(
         "did-frame-navigate",
         {},
         "app://main/other.html",
         200,
         "OK",
         isMainFrame,
         frameProcessId,
         frameRoutingId,
      );

   it("rejects the question of contents when a navigation commits, and leaves nothing behind", async () => {
      const { ipc, reply } = await loadMain();
      vi.useFakeTimers();
      const contents = createContents(1);
      const answer = ipc.hasUnsavedChanges.invokeWith(contents, { timeoutMs: 5000 }, 7);
      const second = ipc.describe.invoke(contents);
      const rejected = [
         expect(answer).rejects.toMatchObject({ ...gone, channel: "hasUnsavedChanges" }),
         expect(second).rejects.toMatchObject({ ...gone, channel: "describe" }),
      ];
      const [[id]] = questions(contents.send, "hasUnsavedChanges");

      navigate(contents);

      await Promise.all(rejected);
      expect(vi.getTimerCount()).toBe(0);
      for (const event of ["destroyed", "render-process-gone", "did-navigate"]) {
         expect(contents.listenerCount(event)).toBe(0);
      }
      expect(contents.listenerCount("did-frame-navigate")).toBe(0);
      expect(() => reply("hasUnsavedChanges", contents, id, ok(true))).not.toThrow();
   });

   it("rejects the question of a window, which asks its contents", async () => {
      const { ipc } = await loadMain();
      const contents = createContents(1);

      const answer = ipc.hasUnsavedChanges.invoke({ webContents: contents }, 7);
      navigate(contents);

      await expect(answer).rejects.toMatchObject(gone);
   });

   it("keeps the question of contents for a navigation inside the page, or of a frame", async () => {
      const { ipc, reply } = await loadMain();
      const contents = createContents(1);
      const answer = ipc.hasUnsavedChanges.invoke(contents, 7);
      const [[id]] = questions(contents.send, "hasUnsavedChanges");
      const settled = vi.fn();
      answer.then(settled, settled);

      contents.emit("did-navigate-in-page", {}, "app://main/#top", true, 4, 1);
      contents.emit("did-start-navigation", {});
      contents.emit("did-frame-navigate", {}, "app://main/f", 200, "OK", false, 4, 10);
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();

      reply("hasUnsavedChanges", contents, id, ok("still here"));
      await expect(answer).resolves.toBe("still here");
   });

   it("lets the old page answer while a navigation is still pending", async () => {
      const { ipc, reply } = await loadMain();
      const contents = createContents(1);
      const answer = ipc.hasUnsavedChanges.invoke(contents, 7);
      const [[id]] = questions(contents.send, "hasUnsavedChanges");

      // The start of a navigation, and one which beforeunload cancelled, never commit.
      contents.emit("did-start-navigation", {});
      contents.emit("did-start-loading");
      contents.emit("did-fail-load", {}, -3, "ERR_ABORTED");
      reply("hasUnsavedChanges", contents, id, ok("old page"));

      await expect(answer).resolves.toBe("old page");
   });

   it("rejects the question of a frame when that frame navigates", async () => {
      const contents = createContents(1);
      const { ipc } = await loadMain("ask-channels", () => contents);
      const frame = createFrame({ processId: 4, routingId: 10 });
      const answer = ipc.hasUnsavedChanges.invoke(frame, 7);

      frameNavigate(contents, false, 4, 10);

      await expect(answer).rejects.toMatchObject(gone);
      expect(contents.listenerCount("did-frame-navigate")).toBe(0);
      expect(contents.listenerCount("destroyed")).toBe(0);
   });

   it("keeps the question of a frame while another frame navigates", async () => {
      const contents = createContents(1);
      const { ipc, reply } = await loadMain("ask-channels", () => contents);
      const frame = createFrame({ processId: 4, routingId: 10 });
      const answer = ipc.hasUnsavedChanges.invoke(frame, 7);
      const [[id]] = questions(frame.send, "hasUnsavedChanges");

      frameNavigate(contents, false, 4, 11);
      frameNavigate(contents, false, 5, 10);
      navigate(contents);
      reply("hasUnsavedChanges", contents, id, ok("frame"), frame);

      await expect(answer).resolves.toBe("frame");
      expect(contents.listenerCount("did-frame-navigate")).toBe(0);
   });

   it("rejects the question of a subframe when the main frame navigates away", async () => {
      const contents = createContents(1);
      const { ipc } = await loadMain("ask-channels", () => contents);
      const frame = createFrame({ processId: 4, routingId: 10 });
      const answer = ipc.hasUnsavedChanges.invoke(frame, 7);

      frameNavigate(contents, true, 4, 1);

      await expect(answer).rejects.toMatchObject(gone);
   });

   it("rejects the question of a frame which is replaced by a new one when it navigates", async () => {
      const contents = createContents(1);
      const { ipc } = await loadMain("ask-channels", () => contents);
      const frame = createFrame({ processId: 4, routingId: 10 });
      const answer = ipc.hasUnsavedChanges.invoke(frame, 7);

      // The new document has IDs of its own, and the old frame is gone by then.
      frame.detached = true;
      frameNavigate(contents, false, 4, 12);

      await expect(answer).rejects.toMatchObject(gone);
   });

   it("rejects the question of a frame whose state cannot be read on a navigation", async () => {
      const contents = createContents(1);
      const { ipc } = await loadMain("ask-channels", () => contents);
      const frame = createFrame({ processId: 4, routingId: 10 });
      const answer = ipc.hasUnsavedChanges.invoke(frame, 7);
      frame.isDestroyed = () => {
         throw new Error("Render frame was disposed");
      };

      frameNavigate(contents, false, 4, 12);

      await expect(answer).rejects.toMatchObject(gone);
   });

   it("settles only once when a navigation follows the destruction", async () => {
      const { ipc } = await loadMain();
      const contents = createContents(1);
      const answer = ipc.hasUnsavedChanges.invoke(contents, 7);

      contents.emit("destroyed");
      navigate(contents);

      await expect(answer).rejects.toMatchObject(gone);
   });
});

describe("ask, main process, replies that are not meant for a question", () => {
   it("ignores replies of other contents, for unknown IDs, and on the reply channel of another channel", async () => {
      const { ipc, reply, electron } = await loadMain();
      const contents = createContents(1);
      const stranger = createContents(2);
      const answer = ipc.hasUnsavedChanges.invoke(contents, 7);
      ipc.describe.invoke(contents);
      const [[id]] = questions(contents.send, "hasUnsavedChanges");
      const settled = vi.fn();
      answer.then(settled, settled);

      reply("hasUnsavedChanges", stranger, id, ok("forged"));
      reply("hasUnsavedChanges", contents, id + 1000, ok("unknown"));
      reply("hasUnsavedChanges", contents, String(id), ok("a string ID"));
      reply("hasUnsavedChanges", contents, undefined, ok("no ID"));
      reply("describe", contents, id, ok("the wrong channel"));
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      expect(electron.ipcMain.on).toHaveBeenCalledTimes(2);

      reply("hasUnsavedChanges", contents, id, ok(true));
      await expect(answer).resolves.toBe(true);
   });

   it("counts only the first reply", async () => {
      const { ipc, reply } = await loadMain();
      const contents = createContents(1);

      const answer = ipc.hasUnsavedChanges.invoke(contents, 7);
      const [[id]] = questions(contents.send, "hasUnsavedChanges");
      reply("hasUnsavedChanges", contents, id, ok("first"));
      reply("hasUnsavedChanges", contents, id, {
         ok: false,
         error: { name: "Late", message: "x" },
      });
      reply("hasUnsavedChanges", contents, id, ok("third"));

      await expect(answer).resolves.toBe("first");
   });

   it("ignores a reply whose sender cannot be inspected", async () => {
      const { ipc, replyListener } = await loadMain();
      const contents = createContents(1);
      const answer = ipc.hasUnsavedChanges.invoke(contents, 7);
      const [[id]] = questions(contents.send, "hasUnsavedChanges");
      const settled = vi.fn();
      answer.then(settled, settled);

      const event = {
         get sender(): never {
            throw new Error("Object has been destroyed");
         },
      };
      replyListener("hasUnsavedChanges")?.(event, id, ok(true));
      await Promise.resolve();

      expect(settled).not.toHaveBeenCalled();
   });
});
