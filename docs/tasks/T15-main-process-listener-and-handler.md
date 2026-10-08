# T15: Main-process listener and handler disposers and `handleOnce`

Phase 2: Core API, listener lifecycle and security.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:**
  - Main `ipc.<name>.on` and `ipc.<name>.handle` return nothing removable.
  - Registering a Unicast handler twice throws (window recreation, dev hot restart).
- **Scope:**
  - Return disposers (`ipcMain.off` / `ipcMain.removeHandler`).
  - Add `ipc.<name>.once` / `ipc.<name>.handleOnce`.
  - Re-registering a handler for the same channel replaces the old one (`removeHandler`, then
    `handle`), so window re-creation and dev hot-restart work. Document this in the README.
- **Tests:** runtime tests of generated `main.ts` with a mocked `electron` module.
- **Delivered:** 2026-10-08. Main `ipc.<name>.on` / `once` (send) and `handle` / `handleOnce` (invoke) return `() => void` disposers (`ipcMain.off` / `ipcMain.removeHandler`). `handle` and `handleOnce` call `removeHandler` first, so a repeated registration replaces the old handler. A generated `registeredHandlers` object (no globals, since a schema type may shadow `Map`) makes the disposer of a replaced handler a no-op; it is reserved against schema type names. The fake `ipcMain` of the test utils gained the new methods.
