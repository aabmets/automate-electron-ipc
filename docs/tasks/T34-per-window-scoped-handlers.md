# T34: Per-window scoped handlers (`webContents.ipc`)

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** per-document windows must look up their state by `event.sender.id`. Electron supports
  handlers scoped to one `webContents`/frame.
- **Scope:**
  - Add a `webContents` option to `ipc.<name>.handle` / `ipc.<name>.on` that registers on
    `webContents.ipc` instead of the global `ipcMain`.
  - Return a disposer, and auto-dispose on `destroyed`.
- **Tests:** runtime tests: scoped handler wins over global (per Electron's dispatch order),
  auto-dispose.
- **Delivered:**
