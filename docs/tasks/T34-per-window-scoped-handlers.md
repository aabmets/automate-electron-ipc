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
- **Delivered:** 2026-10-09. `on`, `once`, `handle` and `handleOnce` of the channels that a page calls (also the `handle` of a `stream` channel) take `{ webContents }` as a second argument and register on `webContents.ipc` instead of `ipcMain`. The generated `resolveIpcTarget` picks the target: the global `ipcMain` with the existing handler registry, or `contents.ipc` with a registry of its own per contents (so `handle` replaces only its own target's handler, and a stale disposer still does nothing). Registrations of some contents share one `destroyed` listener (Node warns above ten), which disposes all of them and drops the registry; the disposers can be called afterwards. Contents that are already destroyed throw `TypeError('Object has been destroyed')`. Sender checks, `scopes` and `validate` apply as before. Deviations: (1) `registeredHandlers` is now declared for every schema with a channel that a page calls, not only for `invoke` channels, since the resolver refers to it; (2) the typing is `WebContents` only, not a window or a view; (3) frame-scoped handlers (`webFrameMain.ipc`, Electron's other level) are not generated. The dispatch order is covered by real-Electron scenarios (the handler of the contents wins an `invoke`, a `send` reaches both targets, destruction removes the registrations), by runtime tests with fake contents, by writer tests and by a type-check fixture (`contents-handlers`) that also checks the rejected forms; the fixture `reserved-names` gained schema types named like the new generated names.
