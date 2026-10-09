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
   currentProject,
   generateFixture,
   replyOf,
   request,
} from "@testutils/e2e/ask-utils.js";
import {
   callablePaths,
   createFakePreloadElectron,
   loadGenerated,
   windowIpcPaths,
} from "@testutils/e2e/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanupAsks);

describe("ask, preload script", () => {
   async function loadPreload() {
      const project = await generateFixture("ask-channels");
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
         windowIpcPaths(currentProject()?.generated["window.d.ts"] ?? ""),
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
