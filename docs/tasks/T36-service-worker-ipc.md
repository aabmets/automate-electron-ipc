# T36: Service worker IPC (Electron ≥ 35, experimental)

Phase 3: Missing Electron features.
Status and dependencies are in the [index](./README.md).

- **Problem:** `ServiceWorkerMain.ipc` and `session.registerPreloadScript({ type: 'service-worker' })`
  are unsupported.
- **Scope:**
  - Directions `ServiceWorkerToMain` and `MainToServiceWorker`.
  - Note that `IpcMainServiceWorker` has no `off` (use `removeListener`) and its events have no
    `senderFrame` (sender validation uses `versionId`/`scope`).
  - Generate a SW preload.
- **Tests:** runtime tests with mocks.
- **Delivered:**
