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
   createFakeElectron,
   createFakePreloadElectron,
   createFakeWindow,
   loadGenerated,
} from "@testutils/e2e/runtime-utils.js";
import { fixtures } from "@testutils/fixture-tracker.js";
import { describe, expect, it, vi } from "vitest";

/**
 * The channel names that the generated code passes to Electron, as written in the text. The
 * `:close` name of a port channel is the name of the channel with a suffix, which the main process
 * builds at runtime, so it is counted as the channel.
 */
function wireNames(text: string): string[] {
   const calls =
      /(?:electronIpcMain|target\.ipc|ipcRenderer)\.\w+\(\s*'([^']+)'|(?:send|postMessage|connectPorts|listenToChannel)\(\s*'([^']+)'/g;
   const names = Array.from(text.matchAll(calls), (match) =>
      (match[1] ?? match[2]).replace(/:close$/, ""),
   );
   return Array.from(new Set(names)).sort();
}

const CHANNELS = ["chat", "getTime", "getUser", "logLine", "progress", "titleChanged"];

describe.each([
   ["all-kinds", "autoipc:"],
   ["custom-prefix", "my-app/v1:"],
   ["no-prefix", ""],
])("fixture %s, with the prefix '%s'", (fixture, prefix) => {
   it("puts the prefix in front of every channel name that Electron sees", async () => {
      const project = await fixtures.run(fixture);
      const { "main.ts": main, "preload.ts": preload } = project.generated;

      const expected = CHANNELS.map((name) => `${prefix}${name}`).sort();
      expect(wireNames(main)).toStrictEqual(expected);
      expect(wireNames(preload)).toStrictEqual(expected);
   });

   it("uses the same wire names in the main process and in the preload script", async () => {
      const project = await fixtures.run(fixture);
      const { "main.ts": main, "preload.ts": preload } = project.generated;

      expect(wireNames(main)).toStrictEqual(wireNames(preload));
      expect(wireNames(main)).toHaveLength(CHANNELS.length);
   });

   it("keeps the names of the generated API and of window.d.ts as they are in the schema", async () => {
      const project = await fixtures.run(fixture);

      for (const name of CHANNELS) {
         expect(project.generated["types.ts"]).toContain(`${name}: {`);
         expect(project.generated["preload.ts"]).toContain(`\n   ${name}: `);
         expect(project.generated["main.ts"]).toContain(`\n   ${name}: {`);
      }
      expect(project.generated["types.ts"]).not.toContain(prefix || "\u0000");
   });

   it("generates files that type-check", async () => {
      const project = await fixtures.run(fixture);
      expect(await project.typecheck()).toBe("");
   });

   it("registers and invokes the same wire name at runtime", async () => {
      const project = await fixtures.run(fixture);
      const electron = createFakeElectron();
      const main = loadGenerated(project.generated["main.ts"], { electron });
      const fake = createFakePreloadElectron();
      loadGenerated(project.generated["preload.ts"], { electron: fake.electron });

      main.ipc.getUser.handle(vi.fn());
      main.ipc.logLine.on(vi.fn());
      await fake.exposed.ipc.getUser.invoke(1).catch(() => undefined);
      fake.exposed.ipc.logLine.send("x");

      expect(electron.ipcMain.handle.mock.calls[0][0]).toBe(`${prefix}getUser`);
      expect(electron.ipcMain.on.mock.calls[0][0]).toBe(`${prefix}logLine`);
      expect(fake.electron.ipcRenderer.invoke.mock.calls[0][0]).toBe(`${prefix}getUser`);
      expect(fake.electron.ipcRenderer.send.mock.calls[0][0]).toBe(`${prefix}logLine`);
   });

   it("sends to a window and hands out ports under the wire name", async () => {
      const project = await fixtures.run(fixture);
      const electron = createFakeElectron();
      Object.assign(electron, {
         MessageChannelMain: class {
            port1 = { name: "port1" };
            port2 = { name: "port2" };
         },
      });
      const main = loadGenerated(project.generated["main.ts"], { electron });
      const win = createFakeWindow();
      const loaded = () =>
         Object.assign(createFakeWindow(), {
            webContents: {
               postMessage: vi.fn(),
               send: vi.fn(),
               on: vi.fn(),
               off: vi.fn(),
               isLoading: () => false,
               isDestroyed: () => false,
               getURL: () => "app://.",
            },
         });
      const one = loaded();
      const two = loaded();

      main.ipc.progress.send(win, 5);
      main.ipc.chat.connect(one, two).close();

      expect(win.webContents.send).toHaveBeenCalledWith(`${prefix}progress`, 5, undefined);
      expect(one.webContents.postMessage.mock.calls[0][0]).toBe(`${prefix}chat`);
      expect(one.webContents.send).toHaveBeenCalledWith(`${prefix}chat:close`, "1:a");
   });

   it("listens for the wire name in the preload script, for events and for ports", async () => {
      const project = await fixtures.run(fixture);
      const fake = createFakePreloadElectron();
      loadGenerated(project.generated["preload.ts"], { electron: fake.electron });

      const disposers = [
         fake.exposed.ipc.progress.on(vi.fn()),
         fake.exposed.ipc.progress.once(vi.fn()),
         fake.exposed.ipc.progress.on(vi.fn()),
      ];
      for (const dispose of disposers) {
         dispose();
      }

      // The subscriptions of a channel share one listener of ipcRenderer (T94).
      const { ipcRenderer } = fake.electron;
      const channels = (mock: { mock: { calls: unknown[][] } }) => mock.mock.calls.map((c) => c[0]);
      expect(channels(ipcRenderer.on).filter((name) => name === `${prefix}progress`)).toStrictEqual(
         [`${prefix}progress`],
      );
      expect(channels(ipcRenderer.on)).toContain(`${prefix}chat`);
      expect(channels(ipcRenderer.once)).toStrictEqual([]);
      expect(channels(ipcRenderer.removeListener)).toStrictEqual([`${prefix}progress`]);
   });

   it("gives the hooks and the errors the name from the schema, not the wire name", async () => {
      const project = await fixtures.run(fixture);
      const electron = createFakeElectron();
      const main = loadGenerated(project.generated["main.ts"], { electron });
      const onRejected = vi.fn();
      main.configureIpc({ validateSender: () => false, onRejected });
      main.ipc.getUser.handle(vi.fn());
      const [, wrapper] = electron.ipcMain.handle.mock.calls[0];

      const reply = await wrapper({ senderFrame: { origin: "app://." } }, 1);

      expect(onRejected.mock.calls[0][1]).toBe("getUser");
      expect(reply.error.message).toContain("'getUser'");
      expect(reply.error.message).not.toContain(prefix ? `'${prefix}getUser'` : "\u0000");
   });
});

describe("registeredHandlers and disposers", () => {
   it("removes the handler of the wire name when the disposer is called", async () => {
      const project = await fixtures.run("custom-prefix");
      const electron = createFakeElectron();
      const main = loadGenerated(project.generated["main.ts"], { electron });

      const dispose = main.ipc.getUser.handle(vi.fn());
      dispose();

      expect(electron.ipcMain.removeHandler).toHaveBeenLastCalledWith("my-app/v1:getUser");
   });

   it("removes the listener of the wire name when the disposer is called", async () => {
      const project = await fixtures.run("custom-prefix");
      const electron = createFakeElectron();
      const main = loadGenerated(project.generated["main.ts"], { electron });

      const listener = vi.fn();
      main.ipc.logLine.on(listener)();

      expect(electron.ipcMain.off).toHaveBeenCalledWith("my-app/v1:logLine", expect.any(Function));
   });
});
