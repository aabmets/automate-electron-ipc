# T26: Main ↔ renderer port channels

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** high-frequency data such as log tailing, audio meters or progress pays per-message
  `ipcMain` overhead. Electron recommends `MessagePortMain` for this, but no main-side port endpoint
  is generated.
- **Scope:**
  - New schema kind for a main ↔ renderer port.
  - The main gets a typed `MessagePortMain` wrapper (`start()`, `postMessage`, `on('message')`,
    `'close'`).
  - The renderer gets the same API as T24.
- **Tests:** runtime tests with a mocked `MessageChannelMain`.
- **Delivered:** 2026-10-08. Notes:
  - New verb `mainPort<Sig>()`, which parses to kind `Port` with direction `MainToRenderer` (the
    validator now allows both directions for `Port`). One signature types the messages in both
    directions, like `port`. It has no options.
  - `main.ts` declares `connectMainPort` only when a `mainPort` channel exists. `ipc.<name>.connect(target)`
    takes a window, a view or contents, and returns `{ send, on, onReady, onClose, close }`: a typed
    wrapper of the `MessagePortMain` that main keeps (`start()` on attach, `postMessage` of the
    argument list, `'message'`, `'close'`). It pairs when the page has loaded and again on every
    `did-finish-load`, with the key `<id>:main`, so the page treats a reload as T24/T25 do. A queue
    holds `send` until a port is there and is flushed before `onReady` runs; a replaced port is
    closed without `onClose`; `close()` is final and tells the page through `<channel>:close`.
  - The renderer needed no new runtime code: `preload.ts` and `window.d.ts` give a `mainPort` channel
    the exact API of a `port` channel (`createPortChannel`), with `onConnection`, so a page can hold
    several connections to main. The writers now branch on `kind === "Port"` before the direction.
  - The ends registry (`portEnds`, `<channel>:disconnect`) of T25 is shared by both kinds of port
    channel, and holds the `WebContents` of an end now, not the window. `Map` and `Set` are reserved
    names of `main.ts` when a port channel exists, and `Function` for a `mainPort` channel.
  - Deviation: no new `window.d.ts` shape, and no main-side aggregate (`onConnection`, broadcast to
    all connections): main creates every connection, so it holds the handles itself.
  - Not done: the queue is unbounded (T73 bounds it). Tests use the real `MessageChannel` of Node,
    wrapped as a `MessagePortMain`, for a round trip between the generated scripts, and fakes
    elsewhere; nothing was run in Electron.
