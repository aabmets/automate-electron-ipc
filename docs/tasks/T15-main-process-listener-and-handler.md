# T15: Main-process listener and handler disposers and `handleOnce`

Phase 2: Core API, listener lifecycle and security.
Status and dependencies are in the [index](./README.md).

- **Problem:**
  - Main `on<X>` and Unicast registration return nothing removable.
  - Registering a Unicast handler twice throws (window recreation, dev hot restart).
- **Scope:**
  - Return disposers (`ipcMain.off` / `ipcMain.removeHandler`).
  - Add `once<X>` / `handleOnce<X>`.
  - Re-registering a Unicast handler either replaces the old one safely or throws a descriptive
    error. Choose one and document it.
- **Tests:** runtime tests of generated `main.ts` with a mocked `electron` module.
- **Delivered:**
