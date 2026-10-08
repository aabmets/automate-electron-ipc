# T21: Main → renderer targets and broadcast-to-all

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:**
  - `ipc.<name>.send` only accepts a `BrowserWindow`. `WebContentsView` (which replaced
    `BrowserView`) and bare `WebContents` are unsupported.
  - "Broadcast" cannot send to all windows (theme or settings sync).
- **Scope:**
  - `ipc.<name>.send(target: BrowserWindow | WebContents | WebContentsView, ...args)`.
  - Add `ipc.<name>.broadcast(...args, opts?: { filter?: (wc) => boolean })` over
    `webContents.getAllWebContents()`, skipping destroyed contents.
- **Tests:** runtime tests with a mocked electron for each target type, destroyed-contents skipping,
  and the filter.
- **Delivered:** 2026-10-08. Notes:
  - Deviation: the filter is the first argument of a separate method,
    `ipc.<name>.broadcastTo(filter, ...args)`, and `broadcast(...args)` sends to all. An options
    object after the arguments is ambiguous when the signature ends in optional or rest
    parameters. The behavior of the task is the same.
  - `send` accepts `BrowserWindow | WebContents | WebContentsView`. The parameter is now called
    `target`, and yields to a parameter of the signature with that name, like `filter` does.
  - `broadcast` asks `webContents.getAllWebContents()` on every call, skips destroyed contents, and
    does not call the filter for them. It includes DevTools contents, as Electron lists them.
  - `send` to a destroyed target still throws. `bind` still takes a `BrowserWindow`, since it
    listens to window events.
  - `WebContents`, `WebContentsView`, `electronWebContents`, `resolveSendTarget` and
    `broadcastMessage` are reserved names in `main.ts`, so schema types of those names are renamed.
  - Checked in Electron 44.7.0: a window, a contents and a view each get their message, a broadcast
    reaches all of them, a filter only the chosen one, and a destroyed window is skipped.
