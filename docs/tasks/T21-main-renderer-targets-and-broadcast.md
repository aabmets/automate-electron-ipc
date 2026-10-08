# T21: Main → renderer targets and broadcast-to-all

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:**
  - `send<X>` only accepts a `BrowserWindow`. `WebContentsView` (which replaced `BrowserView`) and
    bare `WebContents` are unsupported.
  - "Broadcast" cannot send to all windows (theme or settings sync).
- **Scope:**
  - `send<X>(target: BrowserWindow | WebContents | WebContentsView, ...args)`.
  - Add `broadcast<X>(...args, opts?: { filter?: (wc) => boolean })` over
    `webContents.getAllWebContents()`, skipping destroyed contents.
- **Tests:** runtime tests with a mocked electron for each target type, destroyed-contents skipping,
  and the filter.
- **Delivered:**
