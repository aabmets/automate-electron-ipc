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

import { type E2EProject, runFixture } from "@testutils/e2e-utils.js";
import { createFakeElectron, loadGenerated } from "@testutils/runtime-utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

let project: E2EProject | undefined;

afterEach(async () => {
   await project?.cleanup();
   project = undefined;
});

/** A WebContents stand-in: it is destroyed when `destroyed` is set, and sending then throws. */
function createContents(id: number, destroyed = false) {
   const contents = {
      id,
      destroyed,
      send: vi.fn(() => {
         if (contents.destroyed) {
            throw new Error("Object has been destroyed");
         }
      }),
      isDestroyed: () => contents.destroyed,
   };
   return contents;
}

async function loadMain(open: ReturnType<typeof createContents>[] = []) {
   project = await runFixture("all-kinds");
   const electron = createFakeElectron();
   const getAllWebContents = vi.fn(() => open);
   Object.assign(electron, { webContents: { getAllWebContents } });
   const { ipc } = loadGenerated(project.generated["main.ts"], { electron });
   return { ipc, getAllWebContents };
}

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

describe("broadcast", () => {
   it("sends to every contents, with the arguments of the signature", async () => {
      const [a, b, c] = [createContents(1), createContents(2), createContents(3)];
      const { ipc } = await loadMain([a, b, c]);

      ipc.progress.broadcast(50, "half");

      for (const contents of [a, b, c]) {
         expect(contents.send).toHaveBeenCalledOnce();
         expect(contents.send).toHaveBeenCalledWith("autoipc:progress", 50, "half");
      }
   });

   it("skips destroyed contents instead of throwing", async () => {
      const [alive, destroyed, aliveToo] = [
         createContents(1),
         createContents(2, true),
         createContents(3),
      ];
      const { ipc } = await loadMain([alive, destroyed, aliveToo]);

      expect(() => ipc.progress.broadcast(1)).not.toThrow();

      expect(destroyed.send).not.toHaveBeenCalled();
      expect(alive.send).toHaveBeenCalledOnce();
      expect(aliveToo.send).toHaveBeenCalledOnce();
   });

   it("spreads rest arguments, and sends no argument for a channel without any", async () => {
      const contents = createContents(1);
      const { ipc } = await loadMain([contents]);

      ipc.titleChanged.broadcast("title");
      ipc.progress.broadcast(7);

      expect(contents.send.mock.calls).toStrictEqual([
         ["autoipc:titleChanged", "title"],
         ["autoipc:progress", 7, undefined],
      ]);
   });

   it("asks for the open contents again on every call", async () => {
      const first = createContents(1);
      const open = [first];
      const { ipc, getAllWebContents } = await loadMain(open);

      ipc.progress.broadcast(1);
      const late = createContents(2);
      open.push(late);
      ipc.progress.broadcast(2);

      expect(getAllWebContents).toHaveBeenCalledTimes(2);
      expect(first.send).toHaveBeenCalledTimes(2);
      expect(late.send).toHaveBeenCalledOnce();
   });

   it("does nothing when no contents is open", async () => {
      const { ipc } = await loadMain([]);

      expect(() => ipc.progress.broadcast(1)).not.toThrow();
   });

   it("has no broadcast on invoke and send channels", async () => {
      const { ipc } = await loadMain([createContents(1)]);

      expect(ipc.getUser.broadcast).toBeUndefined();
      expect(ipc.logLine.broadcast).toBeUndefined();
   });
});

describe("broadcastTo", () => {
   it("sends only to the contents that the filter accepts", async () => {
      const [a, b, c] = [createContents(1), createContents(2), createContents(3)];
      const { ipc } = await loadMain([a, b, c]);

      ipc.progress.broadcastTo((contents: { id: number }) => contents.id !== 2, 50, "half");

      expect(a.send).toHaveBeenCalledWith("autoipc:progress", 50, "half");
      expect(b.send).not.toHaveBeenCalled();
      expect(c.send).toHaveBeenCalledWith("autoipc:progress", 50, "half");
   });

   it("gives the filter each live contents once, and never a destroyed one", async () => {
      const [alive, destroyed] = [createContents(1), createContents(2, true)];
      const { ipc } = await loadMain([alive, destroyed]);
      const filter = vi.fn(() => true);

      ipc.progress.broadcastTo(filter, 1);

      expect(filter).toHaveBeenCalledTimes(1);
      expect(filter).toHaveBeenCalledWith(alive);
   });

   it("sends to nobody when the filter rejects everything", async () => {
      const contents = createContents(1);
      const { ipc } = await loadMain([contents]);

      ipc.progress.broadcastTo(() => false, 1);

      expect(contents.send).not.toHaveBeenCalled();
   });

   it("lets an error of the filter through, and sends nothing after it", async () => {
      const [a, b] = [createContents(1), createContents(2)];
      const { ipc } = await loadMain([a, b]);

      expect(() =>
         ipc.progress.broadcastTo((contents: { id: number }) => {
            if (contents.id === 2) {
               throw new Error("filter failed");
            }
            return true;
         }, 1),
      ).toThrowError("filter failed");

      expect(a.send).toHaveBeenCalledOnce();
      expect(b.send).not.toHaveBeenCalled();
   });
});

describe("fixture all-kinds", () => {
   it("generates files that type-check, including the targets of send", async () => {
      project = await runFixture("all-kinds");
      expect(await project.typecheck()).toBe("");
   });

   it("imports the web contents of Electron only for emit channels", async () => {
      project = await runFixture("all-kinds");
      expect(project.generated["main.ts"]).toMatch(
         /import \{[^}]*webContents as electronWebContents[^}]*\} from "electron";/,
      );
      await project.cleanup();

      project = await runFixture("handler-types");
      expect(project.generated["main.ts"]).not.toContain("electronWebContents");
      expect(project.generated["main.ts"]).not.toContain("broadcastMessage");
   });
});
