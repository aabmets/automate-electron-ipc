# T59: Schema type names that clash with generated names

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found while integrating T53. The generated files declare or import names of their
  own: `BrowserWindow`, `IpcMainEvent`, `IpcMainInvokeEvent`, `MessageChannelMain`,
  `electronIpcMain`, `contextBridge`, `ipcRenderer` and `Window`. A schema type with one of these
  names is imported under that name and clashes (TS2300), or shadows the Electron type.
- **Scope:** treat the names the writers declare as taken when `ImportsGenerator` assigns names,
  so a clashing schema type gets an alias (`BrowserWindow_2`), as for T53's collisions.
- **Tests:** imports-generator unit tests, plus an e2e fixture with a schema `BrowserWindow` and
  `Window` type that type-checks.
- **Delivered:** 2026-10-08. `ImportsGenerator` takes a list of reserved names, which each writer supplies through `getReservedNames()`: `ipcMain`, `electronIpcMain`, `MessageChannelMain`, `BrowserWindow`, `IpcMainEvent` and `IpcMainInvokeEvent` for main.ts, and `Window` for window.d.ts. They are reserved whether or not the file uses them, so the aliases do not depend on the channels. preload.ts imports no schema types, so it reserves nothing (`contextBridge` and `ipcRenderer` cannot clash). The new e2e fixture is `reserved-names`.
