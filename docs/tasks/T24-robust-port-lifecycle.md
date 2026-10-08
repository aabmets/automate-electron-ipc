# T24: Robust port lifecycle (B9)

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:**
  - `ipc.<name>.connect` posts ports only on `once('ready-to-show')`, so ports are lost if the
    window is already shown or the page reloads.
  - Preload `sendMessage`/`onMessage` throw before the port arrives.
  - Only one `onmessage` handler is allowed.
  - There is no close handling.
- **Scope:**
  - Deliver immediately if loaded, else on `did-finish-load`. Re-pair after a reload of either side.
  - `ipc.<name>.connect` returns a handle with `close()`.
  - The preload queues outgoing messages until the port is ready, supports multiple subscribers with
    disposers, and exposes `onReady`/`onClose`.
- **Tests:** runtime tests: late window, reload, queued sends flushed in order, close events, multiple
  subscribers.
- **Delivered:** 2026-10-08. Notes:
  - `main.ts` declares `connectPorts` (reserved name) only when a `port` channel exists.
    `connect(winA, winB)` returns `{ close() }`. It pairs once both windows are loaded
    (`!isLoading()` and a non-empty `getURL()`), at once if they are, else on `did-finish-load`, and
    again on every `did-finish-load` of either window, which re-pairs after a reload. A window shown
    late no longer matters, since `ready-to-show` is no longer used.
  - Deviation: the main process cannot close ports it has transferred, so `close()` and the
    destruction of a window (`closed`) send `<channel>:close` to the windows that remain, and the
    preload closes its port and runs `onClose`. The close event of the port is handled too, for a
    page that goes away.
  - `preload.ts` declares `createPortChannel` (one per port channel, in a `ports` registry). `send`
    queues until a port is there and flushes in order before `onReady` runs; `on`, `onReady` and
    `onClose` keep any number of subscribers with their own disposers (so the same callback twice is
    two subscriptions); a throwing subscriber is reported to `console.error` and does not stop the
    others. A replaced port is closed without `onClose`. `on` returns a disposer now.
  - Not done: the queue is unbounded. Tests use the real `MessageChannel` of Node for the preload
    script and fakes for the main process; nothing was run in Electron.
