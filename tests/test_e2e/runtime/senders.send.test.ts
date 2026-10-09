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

import { createContents, mainLoader } from "@testutils/e2e/sender-utils.js";
import type { E2EProject } from "@testutils/e2e-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   await project?.cleanup();
   project = undefined;
});

const loadMain = mainLoader((created) => {
   project = created;
});

describe("send, to a window, a view or contents", () => {
   it.each([
      ["a BrowserWindow", () => ({ webContents: createContents(1) })],
      ["a WebContentsView", () => ({ webContents: createContents(2) })],
   ])("sends to the webContents of %s", async (_name, make) => {
      const { ipc } = await loadMain();
      const target = make();

      ipc.progress.send(target, 50, "half");

      expect(target.webContents.send).toHaveBeenCalledWith("autoipc:progress", 50, "half");
   });

   it("sends to a WebContents, which has no webContents of its own", async () => {
      const { ipc } = await loadMain();
      const contents = createContents(3);

      ipc.progress.send(contents, 50, "half");

      expect(contents.send).toHaveBeenCalledOnce();
      expect(contents.send).toHaveBeenCalledWith("autoipc:progress", 50, "half");
   });

   it("sends only to the target, not to other contents", async () => {
      const other = createContents(9);
      const { ipc } = await loadMain([other]);
      const target = createContents(4);

      ipc.progress.send(target, 1);

      expect(other.send).not.toHaveBeenCalled();
   });

   it("still throws for a destroyed target, since the caller handed it over", async () => {
      const { ipc } = await loadMain();

      expect(() => ipc.progress.send(createContents(5, true), 1)).toThrowError(/destroyed/);
   });
});

/** A WebFrameMain stand-in. Sending to a destroyed frame throws, as in Electron. */
function createFrame(state: { destroyed?: boolean; detached?: boolean } = {}) {
   const frame = {
      destroyed: state.destroyed ?? false,
      detached: state.detached ?? false,
      send: vi.fn(() => {
         if (frame.destroyed) {
            throw new Error("Render frame was disposed before WebFrameMain could be accessed");
         }
      }),
      isDestroyed: () => frame.destroyed,
   };
   return frame;
}

describe("send, to a frame", () => {
   it("sends to the frame itself, and not to its contents", async () => {
      const { ipc } = await loadMain([createContents(1)]);
      const frame = createFrame();

      ipc.progress.send(frame, 50, "half");

      expect(frame.send).toHaveBeenCalledOnce();
      expect(frame.send).toHaveBeenCalledWith("autoipc:progress", 50, "half");
   });

   it("still throws for a destroyed frame, since the caller handed it over", async () => {
      const { ipc } = await loadMain();

      expect(() => ipc.progress.send(createFrame({ destroyed: true }), 1)).toThrowError(/disposed/);
   });
});

describe("sendToSender", () => {
   it("sends to the frame that sent the event, and reports it", async () => {
      const other = createContents(9);
      const { ipc } = await loadMain([other]);
      const frame = createFrame();

      const delivered = ipc.progress.sendToSender({ senderFrame: frame }, 50, "half");

      expect(delivered).toBe(true);
      expect(frame.send).toHaveBeenCalledOnce();
      expect(frame.send).toHaveBeenCalledWith("autoipc:progress", 50, "half");
      expect(other.send).not.toHaveBeenCalled();
   });

   it("spreads rest arguments, and sends none for a channel without any", async () => {
      const { ipc } = await loadMain();
      const frame = createFrame();

      ipc.titleChanged.sendToSender({ senderFrame: frame }, "title");

      expect(frame.send).toHaveBeenCalledWith("autoipc:titleChanged", "title");
   });

   it("reads the sender frame once, at the call", async () => {
      const { ipc } = await loadMain();
      const frame = createFrame();
      const read = vi.fn(() => frame);
      const event = {
         get senderFrame() {
            return read();
         },
      };

      ipc.progress.sendToSender(event, 1);

      expect(read).toHaveBeenCalledOnce();
   });

   it.each([
      ["no frame, as after a navigation", () => null],
      ["a destroyed frame", () => createFrame({ destroyed: true })],
      ["a detached frame", () => createFrame({ detached: true })],
   ])("sends nothing and reports it for %s", async (_name, make) => {
      const other = createContents(9);
      const { ipc } = await loadMain([other]);
      const frame = make();

      const delivered = ipc.progress.sendToSender({ senderFrame: frame }, 1);

      expect(delivered).toBe(false);
      if (frame) {
         expect(frame.send).not.toHaveBeenCalled();
      }
      expect(other.send).not.toHaveBeenCalled();
   });

   it("treats a frame that cannot be inspected as gone", async () => {
      const { ipc } = await loadMain();
      const frame = {
         send: vi.fn(),
         isDestroyed: () => {
            throw new Error("Render frame was disposed");
         },
      };
      const throwing = {
         get senderFrame(): never {
            throw new Error("Render frame was disposed");
         },
      };

      expect(ipc.progress.sendToSender({ senderFrame: frame }, 1)).toBe(false);
      expect(ipc.progress.sendToSender(throwing, 1)).toBe(false);
      expect(frame.send).not.toHaveBeenCalled();
   });

   it("works with a frame that has no isDestroyed, as in older Electron versions", async () => {
      const { ipc } = await loadMain();
      const frame = { detached: false, send: vi.fn() };

      expect(ipc.progress.sendToSender({ senderFrame: frame }, 1)).toBe(true);
      expect(frame.send).toHaveBeenCalledWith("autoipc:progress", 1, undefined);
   });

   it("lets an error of the send itself through", async () => {
      const { ipc } = await loadMain();
      const frame = createFrame();
      frame.send.mockImplementation(() => {
         throw new Error("cannot clone");
      });

      expect(() => ipc.progress.sendToSender({ senderFrame: frame }, 1)).toThrowError(
         "cannot clone",
      );
   });

   it("has no sendToSender on invoke and send channels", async () => {
      const { ipc } = await loadMain();

      expect(ipc.getUser.sendToSender).toBeUndefined();
      expect(ipc.logLine.sendToSender).toBeUndefined();
   });
});
