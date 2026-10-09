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
   currentProject,
   type FakeContents,
   loadMain,
   ok,
   questions,
   replyOf,
} from "@testutils/e2e/ask-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanupAsks);

describe("ask, main process, asking", () => {
   it("sends the question with an ID in front of the arguments, and resolves with the answer", async () => {
      const { ipc, reply } = await loadMain();
      const contents = createContents(1);

      const answer = ipc.hasUnsavedChanges.invoke({ webContents: contents }, 7);

      expect(contents.send).toHaveBeenCalledOnce();
      const [[id, ...args]] = questions(contents.send, "hasUnsavedChanges");
      expect(args).toStrictEqual([7]);
      expect(typeof id).toBe("number");
      reply("hasUnsavedChanges", contents, id, ok(true));
      await expect(answer).resolves.toBe(true);
   });

   it.each([
      ["a BrowserWindow", (contents: FakeContents) => ({ webContents: contents })],
      ["a WebContentsView", (contents: FakeContents) => ({ webContents: contents })],
      ["WebContents", (contents: FakeContents) => contents],
   ])("asks %s", async (_name, target) => {
      const { ipc, reply } = await loadMain();
      const contents = createContents(1);
      const other = createContents(2);

      const answer = ipc.hasUnsavedChanges.invoke(target(contents), 7);

      expect(other.send).not.toHaveBeenCalled();
      const [[id]] = questions(contents.send, "hasUnsavedChanges");
      reply("hasUnsavedChanges", contents, id, ok(false));
      await expect(answer).resolves.toBe(false);
   });

   it("spreads rest arguments, and sends none for a signature without parameters", async () => {
      const { ipc, reply } = await loadMain();
      const contents = createContents(1);

      const closed = ipc.confirmClose.invoke(contents, "quit", true, false);
      const state = ipc.getEditorState.invoke(contents);

      const [[closeId, ...closeArgs]] = questions(contents.send, "confirmClose");
      expect(closeArgs).toStrictEqual(["quit", true, false]);
      const [[stateId, ...stateArgs]] = questions(contents.send, "getEditorState");
      expect(stateArgs).toStrictEqual([]);
      reply("confirmClose", contents, closeId, ok(undefined));
      reply("getEditorState", contents, stateId, ok({ documentId: 1, text: "x" }));
      await expect(closed).resolves.toBeUndefined();
      await expect(state).resolves.toStrictEqual({ documentId: 1, text: "x" });
   });

   it("gives every question its own ID", async () => {
      const { ipc } = await loadMain();
      const contents = createContents(1);

      ipc.hasUnsavedChanges.invoke(contents, 1);
      ipc.hasUnsavedChanges.invoke(contents, 2);
      ipc.describe.invoke(contents);

      const ids = contents.send.mock.calls.map(([, id]) => id);
      expect(new Set(ids).size).toBe(3);
   });

   it("listens for the replies of a channel once, at its first question", async () => {
      const { ipc, electron } = await loadMain();
      const contents = createContents(1);
      expect(electron.ipcMain.on).not.toHaveBeenCalled();

      ipc.hasUnsavedChanges.invoke(contents, 1);
      ipc.hasUnsavedChanges.invoke(contents, 2);
      ipc.hasUnsavedChanges.invokeWith(contents, {}, 3);
      expect(electron.ipcMain.on.mock.calls.map(([channel]) => channel)).toStrictEqual([
         replyOf("hasUnsavedChanges"),
      ]);

      ipc.describe.invoke(contents);
      expect(electron.ipcMain.on.mock.calls.map(([channel]) => channel)).toStrictEqual([
         replyOf("hasUnsavedChanges"),
         replyOf("describe"),
      ]);
   });

   it("resolves concurrent questions with their own answers, whatever the order", async () => {
      const { ipc, reply } = await loadMain();
      const first = createContents(1);
      const second = createContents(2);

      const a = ipc.hasUnsavedChanges.invoke(first, 1);
      const b = ipc.hasUnsavedChanges.invoke(second, 2);
      const c = ipc.describe.invoke(first, "c");
      const d = ipc.hasUnsavedChanges.invoke(first, 4);
      const [[idA]] = questions(first.send, "hasUnsavedChanges");
      const [[idB]] = questions(second.send, "hasUnsavedChanges");
      const [[idC]] = questions(first.send, "describe");
      const [, [idD]] = questions(first.send, "hasUnsavedChanges");

      reply("hasUnsavedChanges", first, idD, ok("answer d"));
      reply("describe", first, idC, ok("answer c"));
      reply("hasUnsavedChanges", second, idB, ok("answer b"));
      reply("hasUnsavedChanges", first, idA, ok("answer a"));

      await expect(Promise.all([a, b, c, d])).resolves.toStrictEqual([
         "answer a",
         "answer b",
         "answer c",
         "answer d",
      ]);
   });

   it("names the generated parameters apart from the ones of the signature", async () => {
      const { ipc, reply } = await loadMain();
      const contents = createContents(1);

      const plain = ipc.nameClash.invoke(contents, "a", 1, true);
      const timed = ipc.nameClash.invokeWith(contents, { timeoutMs: 1000 }, "b", 2, false);

      const [[idA, ...argsA], [idB, ...argsB]] = questions(contents.send, "nameClash");
      expect(argsA).toStrictEqual(["a", 1, true]);
      expect(argsB).toStrictEqual(["b", 2, false]);
      reply("nameClash", contents, idA, ok("A"));
      reply("nameClash", contents, idB, ok("B"));
      await expect(Promise.all([plain, timed])).resolves.toStrictEqual(["A", "B"]);
      expect(currentProject()?.generated["main.ts"]).toContain(
         "invokeWith: (_target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, _options: IpcAskOptions, target: string, options: number, args: boolean)",
      );
   });

   it("keeps the generic signature of a channel", async () => {
      const { ipc, reply } = await loadMain();
      const contents = createContents(1);

      const answer = ipc.genericAsk.invoke(contents, 5);

      const [[id, value]] = questions(contents.send, "genericAsk");
      expect(value).toBe(5);
      reply("genericAsk", contents, id, ok(5));
      await expect(answer).resolves.toBe(5);
   });
});

describe("ask, main process, timeout", () => {
   it("rejects when the renderer has not answered in time, and ignores a late answer", async () => {
      const { ipc, IpcAskError, reply } = await loadMain();
      vi.useFakeTimers();
      const contents = createContents(1);

      const answer = ipc.hasUnsavedChanges.invokeWith(contents, { timeoutMs: 100 }, 7);
      const rejected = expect(answer).rejects.toMatchObject({
         name: "IpcAskError",
         code: "IPC_ASK_TIMEOUT",
         channel: "hasUnsavedChanges",
         message: "The renderer did not answer the channel 'hasUnsavedChanges' within 100 ms",
      });
      const [[id]] = questions(contents.send, "hasUnsavedChanges");
      await vi.advanceTimersByTimeAsync(99);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);

      await rejected;
      await expect(answer).rejects.toBeInstanceOf(IpcAskError);
      expect(() => reply("hasUnsavedChanges", contents, id, ok(true))).not.toThrow();
      expect(contents.listenerCount("destroyed")).toBe(0);
      expect(contents.listenerCount("render-process-gone")).toBe(0);
   });

   it("stops the timer when the answer comes first", async () => {
      const { ipc, reply } = await loadMain();
      vi.useFakeTimers();
      const contents = createContents(1);

      const answer = ipc.hasUnsavedChanges.invokeWith(contents, { timeoutMs: 100 }, 7);
      const [[id]] = questions(contents.send, "hasUnsavedChanges");
      expect(vi.getTimerCount()).toBe(1);
      reply("hasUnsavedChanges", contents, id, ok(true));

      await expect(answer).resolves.toBe(true);
      expect(vi.getTimerCount()).toBe(0);
   });

   it("waits for ever without a timeout, which is the default", async () => {
      const { ipc } = await loadMain();
      vi.useFakeTimers();
      const contents = createContents(1);

      ipc.hasUnsavedChanges.invoke(contents, 1);
      ipc.hasUnsavedChanges.invokeWith(contents, {}, 2);
      ipc.hasUnsavedChanges.invokeWith(contents, { timeoutMs: undefined }, 3);
      ipc.hasUnsavedChanges.invokeWith(contents, { timeoutMs: Number.POSITIVE_INFINITY }, 4);

      expect(vi.getTimerCount()).toBe(0);
   });

   it("keeps the timer of a long timeout from firing at once", async () => {
      const { ipc } = await loadMain();
      vi.useFakeTimers();
      const contents = createContents(1);

      const answer = ipc.hasUnsavedChanges.invokeWith(contents, { timeoutMs: 1e12 }, 7);
      const rejected = expect(answer).rejects.toMatchObject({ code: "IPC_ASK_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(1000);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(2147483647);
      await rejected;
   });

   it.each([-1, Number.NaN, "5", null])(
      "rejects the timeout %j, and asks nothing",
      async (timeoutMs) => {
         const { ipc } = await loadMain();
         const contents = createContents(1);

         await expect(
            ipc.hasUnsavedChanges.invokeWith(contents, { timeoutMs }, 7),
         ).rejects.toThrowError(new TypeError("timeoutMs must be a number which is not negative"));
         expect(contents.send).not.toHaveBeenCalled();
      },
   );
});
