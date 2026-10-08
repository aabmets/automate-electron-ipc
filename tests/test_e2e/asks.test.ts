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

import { EventEmitter } from "node:events";
import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import {
   callablePaths,
   createFakeElectron,
   createFakePreloadElectron,
   loadGenerated,
   windowIpcPaths,
} from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   vi.useRealTimers();
   await project?.cleanup();
   project = undefined;
});

const request = (name: string) => `autoipc:${name}`;
const replyOf = (name: string) => `autoipc:${name}:reply`;
const ok = (value: unknown) => ({ ok: true, value });

/** A WebContents stand-in: an emitter which announces its end, as the real one does. */
function createContents(id: number, state: { destroyed?: boolean } = {}) {
   const contents = Object.assign(new EventEmitter(), {
      id,
      destroyed: state.destroyed ?? false,
      getURL: () => "app://.",
      send: vi.fn(),
      isDestroyed: () => contents.destroyed,
   });
   return contents;
}
type FakeContents = ReturnType<typeof createContents>;

/** A WebFrameMain stand-in, which has no `getURL` and is not an emitter of `destroyed`. */
function createFrame(
   ids: { processId: number; routingId: number },
   state: { destroyed?: boolean; detached?: boolean } = {},
) {
   const frame = {
      ...ids,
      destroyed: state.destroyed ?? false,
      detached: state.detached ?? false,
      send: vi.fn(),
      isDestroyed: () => frame.destroyed,
   };
   return frame;
}

/** The IDs and arguments of the questions that were sent to a target. */
function questions(send: ReturnType<typeof vi.fn>, name: string): [number, ...unknown[]][] {
   return send.mock.calls
      .filter(([channel]) => channel === request(name))
      .map(([, id, ...args]) => [id, ...args]);
}

async function loadMain(fixture = "ask-channels", fromFrame?: (frame: unknown) => unknown) {
   project = await runFixture(fixture);
   const electron = createFakeElectron();
   Object.assign(electron, {
      webContents: { getAllWebContents: vi.fn(() => []), fromFrame: fromFrame ?? vi.fn() },
   });
   const generated = loadGenerated(project.generated["main.ts"], { electron });
   const { ipc, IpcAskError } = generated;

   /** The listener that the generated code registered for the replies of the channel. */
   const replyListener = (name: string) => {
      const call = electron.ipcMain.on.mock.calls.find(([channel]) => channel === replyOf(name));
      return (call?.[1] as (...args: unknown[]) => void) ?? null;
   };
   /** Delivers a reply to the main process as `sender` (and `senderFrame`) sent it. */
   const reply = (
      name: string,
      sender: unknown,
      id: unknown,
      envelope: unknown,
      senderFrame: unknown = null,
   ) => {
      const listener = replyListener(name);
      if (!listener) {
         throw new Error(`No reply listener for '${name}'`);
      }
      listener({ sender, senderFrame }, id, envelope);
   };
   return { ipc, IpcAskError, electron, replyListener, reply };
}

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
      expect(project?.generated["main.ts"]).toContain(
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

describe("ask, main process, a target that is gone", () => {
   const gone = (channel: string) => ({
      name: "IpcAskError",
      code: "IPC_ASK_DESTROYED",
      channel,
      message: `The renderer that was asked on the channel '${channel}' is gone`,
   });

   it("rejects at once for contents that are destroyed, without sending", async () => {
      const { ipc, electron } = await loadMain();
      const contents = createContents(1, { destroyed: true });

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
      const contents = createContents(1);
      contents.isDestroyed = () => {
         throw new Error("Object has been destroyed");
      };

      await expect(ipc.hasUnsavedChanges.invoke(contents, 7)).rejects.toMatchObject(
         gone("hasUnsavedChanges"),
      );
      expect(contents.send).not.toHaveBeenCalled();
   });

   it.each(["destroyed", "render-process-gone"])(
      "rejects the question that waits when the contents emit '%s'",
      async (event) => {
         const { ipc, reply } = await loadMain();
         vi.useFakeTimers();
         const contents = createContents(1);
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

   it("lets go of the contents once the question is answered", async () => {
      const { ipc, reply } = await loadMain();
      const contents = createContents(1);

      const answer = ipc.hasUnsavedChanges.invoke(contents, 7);
      expect(contents.listenerCount("destroyed")).toBe(1);
      const [[id]] = questions(contents.send, "hasUnsavedChanges");
      reply("hasUnsavedChanges", contents, id, ok(true));

      await answer;
      expect(contents.listenerCount("destroyed")).toBe(0);
      expect(contents.listenerCount("render-process-gone")).toBe(0);
   });

   it("rejects with the error of the send, and leaves nothing behind", async () => {
      const { ipc, reply } = await loadMain();
      vi.useFakeTimers();
      const contents = createContents(1);
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

describe("ask, preload script", () => {
   async function loadPreload() {
      project = await runFixture("ask-channels");
      const fake = createFakePreloadElectron();
      loadGenerated(project.generated["preload.ts"], { electron: fake.electron });
      /** Delivers a question, as the main process sends it, and returns the reply that follows. */
      const ask = async (name: string, id: number, ...args: unknown[]) => {
         const call = fake.electron.ipcRenderer.on.mock.calls.find(
            ([channel]) => channel === request(name),
         );
         if (!call) {
            throw new Error(`The preload script does not listen on '${name}'`);
         }
         const sent = fake.electron.ipcRenderer.send.mock.calls.length;
         call[1]({ sender: "main" }, id, ...args);
         await vi.waitUntil(() => fake.electron.ipcRenderer.send.mock.calls.length > sent);
         return fake.electron.ipcRenderer.send.mock.calls[sent];
      };
      return { ...fake, ask, ipc: fake.exposed.ipc, send: fake.electron.ipcRenderer.send };
   }

   it("exposes a handle method for each ask, and exactly what window.d.ts declares", async () => {
      const { ipc } = await loadPreload();

      expect(callablePaths(ipc)).toStrictEqual([
         "confirmClose.handle",
         "describe.handle",
         "genericAsk.handle",
         "getEditorState.handle",
         "getUser.invoke",
         "hasUnsavedChanges.handle",
         "nameClash.handle",
         "progress.on",
         "progress.once",
      ]);
      expect(callablePaths(ipc)).toStrictEqual(
         windowIpcPaths(project?.generated["window.d.ts"] ?? ""),
      );
   });

   it("listens for the questions of every ask as soon as it loads", async () => {
      const { electron } = await loadPreload();

      expect(electron.ipcRenderer.on.mock.calls.map(([channel]) => channel)).toStrictEqual(
         [
            "confirmClose",
            "describe",
            "genericAsk",
            "getEditorState",
            "hasUnsavedChanges",
            "nameClash",
         ].map(request),
      );
   });

   it("answers with the return value of the responder, on the reply channel with the same ID", async () => {
      const { ipc, ask } = await loadPreload();
      const responder = vi.fn(() => true);
      ipc.hasUnsavedChanges.handle(responder);

      const [channel, id, envelope] = await ask("hasUnsavedChanges", 41, 7);

      expect(responder).toHaveBeenCalledWith(7);
      expect([channel, id, envelope]).toStrictEqual([
         replyOf("hasUnsavedChanges"),
         41,
         { ok: true, value: true },
      ]);
   });

   it("awaits a responder which answers in a promise, and spreads rest arguments", async () => {
      const { ipc, ask } = await loadPreload();
      ipc.getEditorState.handle(async () => ({ documentId: 1, text: "text" }));
      const closer = vi.fn();
      ipc.confirmClose.handle(closer);

      const [, , state] = await ask("getEditorState", 1);
      const [, , closed] = await ask("confirmClose", 2, "quit", true, false);

      expect(state).toStrictEqual({ ok: true, value: { documentId: 1, text: "text" } });
      expect(closer).toHaveBeenCalledWith("quit", true, false);
      expect(closed).toStrictEqual({ ok: true, value: undefined });
   });

   it("answers that no responder is registered, so that the main process need not wait", async () => {
      const { ask } = await loadPreload();

      const [channel, id, envelope] = await ask("hasUnsavedChanges", 5, 7);

      expect([channel, id]).toStrictEqual([replyOf("hasUnsavedChanges"), 5]);
      expect(envelope).toStrictEqual({
         ok: false,
         error: {
            name: "IpcAskError",
            message: "No handler is registered for the channel 'hasUnsavedChanges'",
            code: "IPC_ASK_NO_HANDLER",
         },
      });
   });

   it.each([
      [
         "an Error with a code and data",
         () => Object.assign(new RangeError("bad"), { code: "E_BAD", data: { id: 1 } }),
         { name: "RangeError", message: "bad", code: "E_BAD", data: { id: 1 } },
      ],
      [
         "a plain object, which keeps its fields through contextBridge",
         () => ({ name: "NotFoundError", message: "gone", code: 404, data: [1, 2] }),
         { name: "NotFoundError", message: "gone", code: 404, data: [1, 2] },
      ],
      ["a string", () => "boom", { name: "Error", message: "boom" }],
      ["undefined", () => undefined, { name: "Error", message: "undefined" }],
      [
         "data which cannot be cloned",
         () => Object.assign(new Error("bad"), { data: () => undefined }),
         { name: "Error", message: "bad" },
      ],
      [
         "an error whose fields throw",
         () =>
            Object.defineProperty({}, "name", {
               get() {
                  throw new Error("unreadable");
               },
            }),
         { name: "Error", message: "The handler failed with an unreadable error" },
      ],
   ])("answers with the error when the responder throws %s", async (_name, make, expected) => {
      const { ipc, ask } = await loadPreload();
      ipc.hasUnsavedChanges.handle(() => {
         throw make();
      });
      ipc.describe.handle(() => Promise.reject(make()));

      const [, , thrown] = await ask("hasUnsavedChanges", 1, 7);
      const [, , rejected] = await ask("describe", 2);

      expect(thrown).toStrictEqual({ ok: false, error: expected });
      expect(rejected).toStrictEqual({ ok: false, error: expected });
   });

   it("replaces the responder, and a disposer removes only its own", async () => {
      const { ipc, ask } = await loadPreload();
      const first = vi.fn(() => "first");
      const second = vi.fn(() => "second");

      const disposeFirst = ipc.hasUnsavedChanges.handle(first);
      const disposeSecond = ipc.hasUnsavedChanges.handle(second);
      expect(typeof disposeFirst).toBe("function");
      expect(disposeFirst()).toBeUndefined();

      expect((await ask("hasUnsavedChanges", 1, 1))[2]).toStrictEqual({
         ok: true,
         value: "second",
      });
      expect(first).not.toHaveBeenCalled();

      disposeSecond();
      const [, , envelope] = await ask("hasUnsavedChanges", 2, 1);
      expect(envelope).toMatchObject({ ok: false, error: { code: "IPC_ASK_NO_HANDLER" } });
      disposeSecond();
   });

   it("keeps the responders of different channels apart", async () => {
      const { ipc, ask } = await loadPreload();
      ipc.hasUnsavedChanges.handle(() => "unsaved");
      ipc.describe.handle(() => "described");

      expect((await ask("describe", 1))[2]).toStrictEqual({ ok: true, value: "described" });
      expect((await ask("hasUnsavedChanges", 2, 1))[2]).toStrictEqual({
         ok: true,
         value: "unsaved",
      });
      expect((await ask("genericAsk", 3, 1))[2]).toMatchObject({ ok: false });
   });

   it("answers concurrent questions by their IDs, in the order that the responders finish", async () => {
      const { ipc, electron, send } = await loadPreload();
      const releases: ((value: string) => void)[] = [];
      ipc.describe.handle(() => new Promise<string>((resolve) => releases.push(resolve)));
      const listener = electron.ipcRenderer.on.mock.calls.find(
         ([channel]) => channel === request("describe"),
      )?.[1];

      listener({}, 10);
      listener({}, 11);
      releases[1]("second");
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      releases[0]("first");
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));

      expect(send.mock.calls).toStrictEqual([
         [replyOf("describe"), 11, { ok: true, value: "second" }],
         [replyOf("describe"), 10, { ok: true, value: "first" }],
      ]);
   });

   it("replaces an answer which cannot be sent with an error, since it would never arrive", async () => {
      const { ipc, ask, send } = await loadPreload();
      ipc.describe.handle(() => "answer");
      send.mockImplementationOnce(() => {
         throw new Error("An object could not be cloned.");
      });

      await ask("describe", 3);

      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[1]).toStrictEqual([
         replyOf("describe"),
         3,
         {
            ok: false,
            error: {
               name: "IpcAskError",
               message:
                  "The answer of the channel 'describe' cannot be sent: An object could not be cloned.",
               code: "IPC_ASK_UNSENDABLE",
            },
         },
      ]);
   });
});

/** A plain object, which contextBridge copies with its fields, unlike an `Error`. */
const plainError = () => ({
   name: "NotFoundError",
   message: "gone",
   code: "NOT_FOUND",
   data: { id: 7 },
});

describe("ask, from the main process to a responder and back", () => {
   /** Joins the generated main process and preload script with fakes of the wire between them. */
   async function connect() {
      const main = await loadMain();
      const preload = createFakePreloadElectron();
      loadGenerated(project?.generated["preload.ts"] ?? "", { electron: preload.electron });
      const { ipcRenderer } = preload.electron;
      const contents = createContents(1);
      contents.send.mockImplementation((channel: string, ...args: unknown[]) => {
         const call = ipcRenderer.on.mock.calls.find(([name]) => name === channel);
         // Electron delivers it later, and without the main process waiting.
         queueMicrotask(() => call?.[1]({ sender: "main" }, ...args));
      });
      ipcRenderer.send.mockImplementation((channel: string, ...args: unknown[]) => {
         const name = channel.replace(/^autoipc:/, "").replace(/:reply$/, "");
         main.reply(name, contents, args[0], args[1]);
      });
      return { ...main, contents, rendererIpc: preload.exposed.ipc };
   }

   it("resolves with what the responder in the renderer returns", async () => {
      const { ipc, contents, rendererIpc } = await connect();
      rendererIpc.hasUnsavedChanges.handle((documentId: number) => documentId === 7);
      rendererIpc.getEditorState.handle(async () => ({ documentId: 3, text: "text" }));

      await expect(ipc.hasUnsavedChanges.invoke(contents, 7)).resolves.toBe(true);
      await expect(ipc.hasUnsavedChanges.invoke(contents, 8)).resolves.toBe(false);
      await expect(ipc.getEditorState.invoke(contents)).resolves.toStrictEqual({
         documentId: 3,
         text: "text",
      });
   });

   it("rejects with the error that the responder throws", async () => {
      const { ipc, IpcAskError, contents, rendererIpc } = await connect();
      rendererIpc.hasUnsavedChanges.handle(() => {
         throw plainError();
      });

      const error = await ipc.hasUnsavedChanges
         .invoke(contents, 7)
         .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(IpcAskError);
      expect(error).toMatchObject({
         name: "NotFoundError",
         message: "gone",
         code: "NOT_FOUND",
         data: { id: 7 },
      });
   });

   it("rejects when no responder is registered, and after it is disposed", async () => {
      const { ipc, contents, rendererIpc } = await connect();

      await expect(ipc.hasUnsavedChanges.invoke(contents, 7)).rejects.toMatchObject({
         code: "IPC_ASK_NO_HANDLER",
      });
      const dispose = rendererIpc.hasUnsavedChanges.handle(() => true);
      await expect(ipc.hasUnsavedChanges.invoke(contents, 7)).resolves.toBe(true);
      dispose();
      await expect(ipc.hasUnsavedChanges.invoke(contents, 7)).rejects.toMatchObject({
         code: "IPC_ASK_NO_HANDLER",
      });
   });
});

describe("ask, generated files", () => {
   it("declares only the handle method of an ask in window.d.ts", async () => {
      project = await runFixture("ask-channels");
      const types = project.generated["window.d.ts"];

      expect(types).toContain(
         "hasUnsavedChanges: {\n      handle: (callback: (documentId: number) => boolean) => () => void;\n   };",
      );
      expect(types).toContain(
         "getEditorState: {\n      handle: (callback: () => Promise<EditorState>) => () => void;\n   };",
      );
      expect(types).toContain(
         "confirmClose: {\n      handle: (callback: (reason: string, ...flags: boolean[]) => void) => () => void;\n   };",
      );
      expect(types).toContain(
         "genericAsk: {\n      handle: (callback: <T>(value: T) => T) => () => void;\n   };",
      );
      // The answer of an ask does not travel as an error of an invoke.
      expect(types).not.toMatch(/hasUnsavedChanges: \{[^}]*@throws/);
   });

   it("types the answer as a promise of the awaited return type of the signature", async () => {
      project = await runFixture("ask-channels");
      const main = project.generated["main.ts"];

      expect(main).toContain(
         "(target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, documentId: number): Promise<Awaited<boolean>> =>",
      );
      // A signature which already returns a promise is not wrapped again.
      expect(main).toContain(
         "(target: BrowserWindow | WebContents | WebContentsView | WebFrameMain): Promise<EditorState> =>",
      );
      expect(main).toContain(
         "<T>(target: BrowserWindow | WebContents | WebContentsView | WebFrameMain, value: T): Promise<Awaited<T>> =>",
      );
   });

   it("uses the wire names with the prefix, and a reply channel that no other channel can have", async () => {
      project = await runFixture("ask-channels");
      const { "main.ts": main, "preload.ts": preload } = project.generated;

      expect(main).toContain(
         "askRenderer('hasUnsavedChanges', 'autoipc:hasUnsavedChanges', 'autoipc:hasUnsavedChanges:reply', target",
      );
      expect(preload).toContain("ipcRenderer.on('autoipc:hasUnsavedChanges',");
      expect(preload).toContain("'autoipc:hasUnsavedChanges:reply'");
   });

   it("generates files that type-check", async () => {
      project = await runFixture("ask-channels");
      expect(await project.typecheck()).toBe("");
   });

   it("generates files that type-check when the schema has only asks", async () => {
      project = await runFixture("ask-only");
      expect(await project.typecheck()).toBe("");
      const main = project.generated["main.ts"];
      expect(main).toContain(
         'import { ipcMain as electronIpcMain, webContents as electronWebContents } from "electron";',
      );
      // Nothing of the senders of the renderer, or of the envelope of the invoke channels.
      expect(main).not.toContain("isSenderAllowed");
      expect(main).not.toContain("settleInvoke");
      expect(main).not.toContain("registeredHandlers");
      expect(main).not.toContain("broadcastMessage");
   });
});
