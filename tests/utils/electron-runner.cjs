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
const {
   app,
   BrowserWindow,
   ipcMain,
   protocol,
   session,
   utilityProcess,
   webContents,
} = require("electron");

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

/** The pages that a scenario served with `ctx.serve`, by URL: `{ body, type }`. */
let routes = new Map();

/** The script of the service workers of the scenarios: it runs the functions that `ctx.inWorker` sends. */
const WORKER_SCRIPT = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
   const { id, source, args } = event.data;
   event.waitUntil((async () => {
      let reply;
      try {
         const value = await (0, eval)("(" + source + ")")(...args);
         reply = { id, ok: true, value };
      } catch (error) {
         reply = { id, ok: false, error: { name: error?.name, message: String(error?.message ?? error), code: error?.code, data: error?.data } };
      }
      event.source.postMessage(reply);
   })());
});
`;

function respond(request) {
   const url = new URL(request.url);
   // `url.origin` is "null" for a scheme which is not special in the URL standard, as `app` is.
   const route = routes.get(`${url.protocol}//${url.host}${url.pathname}`);
   if (route) {
      return new Response(route.body, { headers: { "content-type": route.type } });
   }
   if (url.pathname === "/sw.js") {
      return new Response(WORKER_SCRIPT, { headers: { "content-type": "text/javascript" } });
   }
   return new Response(
      `<!doctype html><meta charset="utf-8"><title>${url.host}</title><p>${url.host}</p>`,
      { headers: { "content-type": "text/html" } },
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
let sessionCount = 0;

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
       * the child once it has spawned. The child is killed when the scenario ends. It is forked by
       * `forkUtility` of the generated `main.ts`, so that the bindings know it from the start, unless
       * `options.bindings` is false: then `utilityProcess.fork` forks it, and the bindings do not know it.
       */
      async fork(entry, options = {}) {
         const file = path.join(__dirname, `child-${++forkCount}.cjs`);
         const utilityPath = path.join(ipcDir, "utility.js");
         fs.writeFileSync(
            file,
            `const { ipc, IpcUtilityError } = require(${JSON.stringify(utilityPath)});\n(${entry.toString()})();\n`,
         );
         const child =
            options.bindings === false
               ? utilityProcess.fork(file, [], { stdio: "pipe" })
               : ctx.main.forkUtility(file, [], { stdio: "pipe" });
         children.add(child);
         await new Promise((resolve, reject) => {
            child.once("spawn", resolve);
            child.once("exit", (code) =>
               reject(new Error(`The utility process exited with ${code}`)),
            );
         });
         return child;
      },

      /** Serves `body` at `url`, such as "app://main/index.html", as HTML unless `type` says otherwise. */
      serve(url, body, type = "text/html") {
         routes.set(url, { body, type });
      },

      /**
       * A session of its own, which serves the pages of the `app` scheme and runs the generated
       * service worker preload script in its workers. Each scenario gets fresh workers this way.
       */
      workerSession() {
         const ses = session.fromPartition(`service-workers-${++sessionCount}`);
         ses.protocol.handle("app", respond);
         ses.registerPreloadScript({
            type: "service-worker",
            filePath: path.join(ipcDir, "service-worker-preload.js"),
         });
         return ses;
      },

      /**
       * Opens a window on the session, registers the service worker of the runner (`/sw.js`) from
       * its page, and resolves once the worker controls the page. Resolves with the window and the
       * `ServiceWorkerMain` of the worker. `attachServiceWorkers` of the bindings should come first,
       * so that the worker is routed from the start.
       */
      async startWorker(ses, options = {}) {
         const win = await ctx.open({ ...options, webPreferences: { session: ses } });
         await ctx.evaluate(win, () =>
            navigator.serviceWorker
               .register("/sw.js")
               .then(() => navigator.serviceWorker.ready)
               .then(
                  () =>
                     navigator.serviceWorker.controller ||
                     new Promise((resolve) =>
                        navigator.serviceWorker.addEventListener("controllerchange", resolve),
                     ),
               )
               .then(() => true),
         );
         const worker = await ctx.waitFor(() => {
            const running = ses.serviceWorkers.getAllRunning();
            const id = Object.keys(running).find((key) => running[key].scope.startsWith("app://"));
            return id === undefined
               ? undefined
               : ses.serviceWorkers.getWorkerFromVersionID(Number(id));
         }, "the service worker to run");
         return { win, worker };
      },

      /**
       * Runs `fn(...args)` in the service worker that controls the page of `win`, and returns what
       * it returns. `fn` is turned into text, so it can use the globals of the worker, such as `ipc`.
       * A failure comes back as an error with the `name`, `message`, `code` and `data` of what it threw.
       */
      async inWorker(win, fn, ...args) {
         const reply = await ctx.evaluate(
            win,
            (source, callArgs) =>
               new Promise((resolve) => {
                  const id = Math.random();
                  const listener = (event) => {
                     if (event.data && event.data.id === id) {
                        navigator.serviceWorker.removeEventListener("message", listener);
                        resolve(event.data);
                     }
                  };
                  navigator.serviceWorker.addEventListener("message", listener);
                  navigator.serviceWorker.controller.postMessage({ id, source, args: callArgs });
               }),
            fn.toString(),
            args,
         );
         if (reply.ok) {
            return reply.value;
         }
         throw Object.assign(new Error(reply.error.message), reply.error);
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
