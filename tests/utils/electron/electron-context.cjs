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

// The `ctx` that the scenarios of the Electron integration tests get. `electron-runner.cjs` creates
// one for each scenario, and kills the utility processes in `children` when the scenario ends.
// It is plain CommonJS, because it runs in Electron and not in vitest.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow, session, utilityProcess } = require("electron");
const { respond, routes } = require("./electron-pages.cjs");

/** The utility processes which the scenarios forked, so that none outlives its scenario. */
const children = new Set();
let forkCount = 0;
let sessionCount = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Calls `fn()` every 25 ms until it returns something truthy, and returns it. */
async function poll(fn, what, deadline) {
   const value = await fn();
   if (value) {
      return value;
   }
   if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
   }
   await sleep(25);
   return poll(fn, what, deadline);
}

let workerCalls = 0;

function createContext(config, ipcDir) {
   const mainPath = path.join(ipcDir, "main.js");
   /** The preload script of the surface of a scope, or the one of the surface of no scope. */
   const preloadFor = (scope) => path.join(ipcDir, scope ? `preload.${scope}.js` : "preload.js");

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
            (source, callArgs, id) =>
               new Promise((resolve) => {
                  const listener = (event) => {
                     if (event.data?.id === id) {
                        navigator.serviceWorker.removeEventListener("message", listener);
                        resolve(event.data);
                     }
                  };
                  navigator.serviceWorker.addEventListener("message", listener);
                  navigator.serviceWorker.controller.postMessage({ id, source, args: callArgs });
               }),
            fn.toString(),
            args,
            ++workerCalls,
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

      blank(options = {}) {
         return new BrowserWindow({ show: false, webPreferences: webPreferences(options) });
      },

      /** Runs `fn(...args)` in the page (the main world) of a window, contents or frame. */
      evaluate(target, fn, ...args) {
         const code = `(${fn.toString()})(...${JSON.stringify(args)})`;
         return (target.webContents ?? target).executeJavaScript(code, true);
      },

      /** Evaluates `fn(...args)` in the page until it returns something truthy, and returns it. */
      until(target, fn, ...args) {
         return poll(() => ctx.evaluate(target, fn, ...args), fn.toString(), Date.now() + 5000);
      },

      /** Calls `fn()` in the main process until it returns something truthy, and returns it. */
      waitFor(fn, what = fn.toString()) {
         return poll(fn, what, Date.now() + 5000);
      },
   };
   ctx.ipc = ctx.main.ipc;
   return ctx;
}

module.exports = { children, createContext, sleep };
