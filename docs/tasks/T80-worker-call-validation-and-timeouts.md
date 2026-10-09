# T80: Validation and timeouts for service worker calls

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in T36. `invokeFromWorker` and `sendFromWorker` take `allowedOrigins` only. What a
  worker sends is as untrusted as what a page sends, but the options of T17 (`validate`) and T28
  (`timeoutMs`) do not exist for these verbs, and a call whose handler never answers waits for ever.
- **Scope:**
  - `validate` (a Standard Schema of the argument tuple) for `invokeFromWorker` and `sendFromWorker`,
    run in the route of the worker before the callback, with the rules of T17: an invalid `invoke`
    is rejected with an `IpcValidationError` (as a plain object for the worker), an invalid `send` is
    dropped, and `onRejected` of `configureServiceWorkerIpc` hears of both.
  - `timeoutMs` for `invokeFromWorker` and the default `timeoutMs` of the config, with the plain
    `IpcTimeoutError` object of `withTimeout`. The preload script of the worker is the page writer, so the
    `withTimeout` of the page preload is reused; `ServiceWorkerPreloadWriter` sets the timeout to `0` now.
  - Decide whether a timeout is also needed for the questions of `askWorker` from the schema (they have
    `invokeWith(worker, { timeoutMs }, ...)` already).
- **Tests:** parser and validator tests for the options, runtime tests with fake timers and a fake schema,
  and a real-Electron scenario with a hanging handler and one with invalid arguments.
- **Delivered:**
