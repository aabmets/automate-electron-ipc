# T34: Per-window scoped handlers (`webContents.ipc`)

Phase 3: Missing Electron features.
Status and dependencies are in the [index](./README.md).

- **Problem:** per-document windows must look up their state by `event.sender.id`. Electron supports
  handlers scoped to one `webContents`/frame.
- **Scope:**
  - Generate `bind<X>(webContents, handler)` registering on `webContents.ipc`.
  - Return a disposer, and auto-dispose on `destroyed`.
- **Tests:** runtime tests: scoped handler wins over global (per Electron's dispatch order),
  auto-dispose.
- **Delivered:**
