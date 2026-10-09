# T36: Service worker IPC (Electron ≥ 35, experimental)

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `ServiceWorkerMain.ipc` and `session.registerPreloadScript({ type: 'service-worker' })`
  are unsupported.
- **Scope:**
  - Directions `ServiceWorkerToMain` and `MainToServiceWorker`.
  - Note that `IpcMainServiceWorker` has no `off` (use `removeListener`) and its events have no
    `senderFrame` (sender validation uses `versionId`/`scope`).
  - Generate a SW preload.
- **Tests:** runtime tests with mocks.
- **Delivered:** 2026-10-09. Deviations and notes:
  - Four verbs, since the task named only the directions: `invokeFromWorker` and `sendFromWorker`
    (ServiceWorkerToMain, Unicast and Broadcast) and `askWorker` and `emitToWorker` (MainToServiceWorker,
    Unicast and Broadcast). Only the first two take an option, `allowedOrigins`; `invokeFromWorker` takes
    the error types of `invoke`.
  - What a real Electron 44 binary does decided the design (tried in a scratch app before any code): the
    messages of a service worker never reach `ipcMain`, only `serviceWorker.ipc`; a worker sends from its
    preload script before the app can get hold of its `ServiceWorkerMain`; the first status event,
    `starting`, comes before the preload script runs; the preload has `contextBridge`, `ipcRenderer` and
    `nativeImage`, sandboxed and context isolated, and `exposeInMainWorld` reaches the global of the
    worker; the object of a worker is the same for every lookup while it runs. So `main.ts` keeps one hub
    per `Session`, made by `attachServiceWorkers(session)` or by the first `handle` or `on`. It routes
    every channel that a worker calls to callbacks that it holds, on the `ipc` of each worker as it
    starts, so `handle(session, callback)` and `on(session, callback)` take the session and not a worker.
    `IpcMainServiceWorker` has no `off`, so a route is never removed: it looks its callback up when a
    message arrives, and the disposers only change the hub.
  - No `senderFrame`: `allowedOrigins` is compared for equality with the origin of `worker.scope`
    (`url.origin`, or `scheme://host` for a scheme that is not special), and the new
    `configureServiceWorkerIpc({ validateSender, onRejected })` sees the event with `versionId` and
    `serviceWorker.scope`. It is separate from `configureIpc`, whose types stay those of a frame. A
    rejected call throws an `IpcWorkerError` (`IPC_WORKER_FORBIDDEN`, `IPC_WORKER_NO_HANDLER`,
    `IPC_WORKER_DESTROYED`).
  - `askWorker` reuses `IpcAskError` and the reply reader of `ask` (`readAskReply` got a `who` argument).
    The question holds `worker.startTask()` until it is settled, and is rejected with
    `IPC_ASK_DESTROYED` on `stopping` or `stopped` of the worker, `IPC_ASK_NOT_ATTACHED` for a worker that
    no hub knows. Only the worker that was asked can answer.
  - Config `serviceWorkerPreloadPath` (default `service-worker-preload.ts` in `ipcDataDir`); the typings
    are written next to it as `service-worker.d.ts`. Both files exist only for a schema with a worker
    channel. The preload script is the page writer with the worker specs mapped to the page directions
    (`ServiceWorkerPreloadWriter` extends `PreloadBindingsWriter`, the typings extend
    `RendererTypesWriter`), without `isolatedWorldId`, `getPathForFile` and timeouts. The page files
    skip the worker channels. Registering the compiled script with `session.registerPreloadScript` is
    left to the app, which knows the path.
  - Tests: parser, validators, config, automation, public types, the three writers, mock runtime tests of
    `main.ts` (fake session and workers) and of the preload script, e2e type-checks of the page project
    and of a worker project (`typecheckWorker`, `lib: webworker`), and a real-Electron group
    (`tests/test_electron/serviceWorkers.test.ts`) with a real service worker, the generated preload
    script and `main.ts`. The harness got `ctx.workerSession()`, `ctx.startWorker()`, `ctx.inWorker()`
    and `ctx.serve(url, body, type)`.
  - Follow-ups: T80 (`validate` and `timeoutMs` for worker calls), and a line in T43 (stale worker
    files). Not done: message ports to a service worker, and stopping a worker to test
    `IPC_ASK_DESTROYED` in real Electron (a pending question holds the worker alive with `startTask`),
    which the mock tests cover.
