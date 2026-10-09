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

// The main process script of the Electron integration tests. `electron-utils.ts` copies it into a
// temp app dir, next to `electron-context.cjs`, `electron-pages.cjs`, `config.json`, `scenarios.cjs`
// and the generated bindings compiled to CommonJS, and starts the `electron` binary on that dir.
//
// It runs the scenarios one after another and prints their results as one line of JSON that starts
// with RESULT_MARK. It is plain CommonJS, because it runs in Electron and not in vitest.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, protocol, webContents } = require("electron");
const { children, createContext, sleep } = require("./electron-context.cjs");
const { respond, routes } = require("./electron-pages.cjs");

const RESULT_MARK = "@@ELECTRON-RESULT@@";
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const scenarios = require("./scenarios.cjs");

const ipcDir = path.join(__dirname, config.ipcDir);

// An uncaught error in the main process would open a dialog and block the run.
const uncaught = [];
const describeError = (error) =>
   error instanceof Error ? `${error.stack ?? error.message}` : String(error);
process.on("uncaughtException", (error) => uncaught.push(describeError(error)));
process.on("unhandledRejection", (error) => uncaught.push(describeError(error)));
// A preload script that throws while it loads leaves the page without its API, and nothing in the
// main process would notice: Electron reports it with this event only.
app.on("web-contents-created", (_event, contents) => {
   contents.on("preload-error", (_preloadEvent, preloadPath, error) =>
      uncaught.push(`preload-error in ${preloadPath}: ${describeError(error)}`),
   );
});

// Without a listener, Electron quits when the scenarios close their last window.
app.on("window-all-closed", () => undefined);

app.setPath("userData", path.join(__dirname, "user-data"));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-dev-shm-usage");

// Pages are served from a custom scheme, so that their origins are known and can be told apart.
protocol.registerSchemesAsPrivileged([
   {
      scheme: "app",
      privileges: {
         standard: true,
         secure: true,
         supportFetchAPI: true,
         allowServiceWorkers: true,
      },
   },
]);

// Records the channels that were handled, because the scenarios share one ipcMain.
const handledChannels = new Set();
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => {
   handledChannels.add(channel);
   return handle(channel, listener);
};

/** Forgets the modules of the generated bindings, so that each scenario gets fresh state. */
function evictGeneratedModules() {
   for (const file of Object.keys(require.cache)) {
      if (file.startsWith(ipcDir)) {
         delete require.cache[file];
      }
   }
}

function resetProcessState() {
   for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
         win.destroy();
      }
   }
   for (const contents of webContents.getAllWebContents()) {
      if (!contents.isDestroyed()) {
         contents.close();
      }
   }
   for (const child of children) {
      child.kill();
   }
   children.clear();
   ipcMain.removeAllListeners();
   for (const channel of handledChannels) {
      ipcMain.removeHandler(channel);
   }
   handledChannels.clear();
   routes.clear();
   evictGeneratedModules();
}

async function runScenario(name) {
   const scenario = scenarios[name];
   const originalConsole = { warn: console.warn, error: console.error };
   let timer;
   try {
      const ctx = createContext(config, ipcDir);
      const timeout = new Promise((_resolve, reject) => {
         timer = setTimeout(
            () =>
               reject(
                  new Error(`The scenario did not finish within ${config.scenarioTimeoutMs} ms`),
               ),
            config.scenarioTimeoutMs,
         );
      });
      const value = await Promise.race([scenario(ctx), timeout]);
      return { ok: true, value };
   } catch (error) {
      return { ok: false, error: describeError(error) };
   } finally {
      clearTimeout(timer);
      Object.assign(console, originalConsole);
      resetProcessState();
      // The windows are gone only once their processes noticed.
      await sleep(50);
   }
}

async function main() {
   await app.whenReady();
   protocol.handle("app", respond);
   const results = {};
   for (const name of Object.keys(scenarios)) {
      // The scenarios share one process, so they run one after another.
      results[name] = await runScenario(name);
   }
   const line = `\n${RESULT_MARK}${JSON.stringify({ results, uncaught })}\n`;
   process.stdout.write(line, () => app.exit(0));
}

main().catch((error) => {
   process.stderr.write(`${describeError(error)}\n`);
   app.exit(1);
});
