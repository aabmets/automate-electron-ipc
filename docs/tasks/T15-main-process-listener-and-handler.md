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
- **Delivered:**
