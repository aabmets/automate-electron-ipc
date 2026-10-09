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
// temp app dir, next to `config.json`, `scenarios.cjs` and the generated bindings compiled to
// CommonJS, and starts the `electron` binary on that dir.
//
// It runs the scenarios one after another and prints their results as one line of JSON that starts
// with RESULT_MARK. It is plain CommonJS, because it runs in Electron and not in vitest.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, protocol, utilityProcess, webContents } = require("electron");

const RESULT_MARK = "@@ELECTRON-RESULT@@";
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const scenarios = require("./scenarios.cjs");

const ipcDir = path.join(__dirname, config.ipcDir);
const mainPath = path.join(ipcDir, "main.js");
/** The preload script of the surface of a scope, or the one of the surface of no scope. */
const preloadFor = (scope) => path.join(ipcDir, scope ? `preload.${scope}.js` : "preload.js");

// An uncaught error in the main process would open a dialog and block the run.
const uncaught = [];
const describeError = (error) =>
   error instanceof Error ? `${error.stack ?? error.message}` : String(error);
process.on("uncaughtException", (error) => uncaught.push(describeError(error)));
process.on("unhandledRejection", (error) => uncaught.push(describeError(error)));

// Without a listener, Electron quits when the scenarios close their last window.
app.on("window-all-closed", () => undefined);

app.setPath("userData", path.join(__dirname, "user-data"));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-dev-shm-usage");

// Pages are served from a custom scheme, so that their origins are known and can be told apart.
protocol.registerSchemesAsPrivileged([
   { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/** The pages that a scenario served with `ctx.serve`, by URL. */
let routes = new Map();

function pageFor(request) {
   const url = new URL(request.url);
   // `url.origin` is "null" for a scheme which is not special in the URL standard, as `app` is.
   const html = routes.get(`${url.protocol}//${url.host}${url.pathname}`);
   return (
      html ?? `<!doctype html><meta charset="utf-8"><title>${url.host}</title><p>${url.host}</p>`
   );
}

// Records the channels that were handled, because the scenarios share one ipcMain.
const handledChannels = new Set();
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => {
   handledChannels.add(channel);
   return handle(channel, listener);
};

/** The utility processes which the scenarios forked, so that none outlives its scenario. */
const children = new Set();
let forkCount = 0;

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
   routes = new Map();
   evictGeneratedModules();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createContext() {
   const webPreferences = (options = {}) => ({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: options.subframes === true,
      backgroundThrottling: false,
      preload: preloadFor(options.scope),
      ...options.webPreferences,
   });

   const ctx = {
      electron: require("electron"),
      /** The exports of the generated `main.ts`. */
      main: require(mainPath),
      data: config.data,
      webPreferences,
      sleep,

      /**
       * Forks a utility process which runs `entry`: a function, turned into text, that can use
       * `ipc` and `IpcUtilityError` of the generated `utility.ts`, and `process`. It resolves with
       * the child once it has spawned. The child is killed when the scenario ends.
       */
      async fork(entry) {
         const file = path.join(__dirname, `child-${++forkCount}.cjs`);
         const utilityPath = path.join(ipcDir, "utility.js");
         fs.writeFileSync(
            file,
            `const { ipc, IpcUtilityError } = require(${JSON.stringify(utilityPath)});\n(${entry.toString()})();\n`,
         );
         const child = utilityProcess.fork(file, [], { stdio: "pipe" });
         children.add(child);
         await new Promise((resolve, reject) => {
            child.once("spawn", resolve);
            child.once("exit", (code) =>
               reject(new Error(`The utility process exited with ${code}`)),
            );
         });
         return child;
      },

      /** Serves `html` at `url`, such as "app://main/index.html". */
      serve(url, html) {
         routes.set(url, html);
      },

      /**
       * Opens a hidden window with the generated preload script, and waits until it loaded and
       * until Electron stopped loading it. `loadURL` resolves, and `did-finish-load` fires, while
       * `isLoading()` is still true, and the scenarios which are about that use `blank()`.
       */
      async open(options = {}) {
         const win = new BrowserWindow({
            show: false,
            width: 400,
            height: 300,
            webPreferences: webPreferences(options),
         });
         await win.loadURL(options.url ?? "app://main/index.html");
         await ctx.waitFor(() => !win.webContents.isLoading(), "the page to stop loading");
         return win;
      },

      /** Opens a hidden window that has not loaded anything. */
      blank(options = {}) {
         return new BrowserWindow({ show: false, webPreferences: webPreferences(options) });
      },

      /** Runs `fn(...args)` in the page (the main world) of a window, contents or frame. */
      evaluate(target, fn, ...args) {
         const code = `(${fn.toString()})(...${JSON.stringify(args)})`;
         return (target.webContents ?? target).executeJavaScript(code, true);
      },

      /** Evaluates `fn(...args)` in the page until it returns something truthy, and returns it. */
      async until(target, fn, ...args) {
         const deadline = Date.now() + 5000;
         for (;;) {
            const value = await ctx.evaluate(target, fn, ...args);
            if (value) {
               return value;
            }
            if (Date.now() > deadline) {
               throw new Error(`Timed out waiting for ${fn.toString()}`);
            }
            await sleep(25);
         }
      },

      /** Calls `fn()` in the main process until it returns something truthy, and returns it. */
      async waitFor(fn, what = fn.toString()) {
         const deadline = Date.now() + 5000;
         for (;;) {
            const value = await fn();
            if (value) {
               return value;
            }
            if (Date.now() > deadline) {
               throw new Error(`Timed out waiting for ${what}`);
            }
            await sleep(25);
         }
      },
   };
   ctx.ipc = ctx.main.ipc;
   return ctx;
}

async function runScenario(name) {
   const scenario = scenarios[name];
   const originalConsole = { warn: console.warn, error: console.error };
   let timer;
   try {
      const ctx = createContext();
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
   protocol.handle(
      "app",
      (request) => new Response(pageFor(request), { headers: { "content-type": "text/html" } }),
   );
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
