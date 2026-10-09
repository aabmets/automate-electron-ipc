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

// The pages that the Electron integration tests serve from the `app` scheme. `electron-runner.cjs`
// registers `respond` as the handler of the scheme, and `electron-context.cjs` fills `routes`.
// It is plain CommonJS, because it runs in Electron and not in vitest.

"use strict";

/** The pages that a scenario served with `ctx.serve`, by URL: `{ body, type }`. */
const routes = new Map();

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

module.exports = { respond, routes };
