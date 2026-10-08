# T24: Robust port lifecycle (B9)

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:**
  - `propagate` posts ports only on `once('ready-to-show')`, so ports are lost if the window is
    already shown or the page reloads.
  - Preload `sendMessage`/`onMessage` throw before the port arrives.
  - Only one `onmessage` handler is allowed.
  - There is no close handling.
- **Scope:**
  - Deliver immediately if loaded, else on `did-finish-load`. Re-pair after a reload of either side.
  - `propagate` returns a handle with `close()`.
  - The preload queues outgoing messages until the port is ready, supports multiple subscribers with
    disposers, and exposes `onReady`/`onClose`.
- **Tests:** runtime tests: late window, reload, queued sends flushed in order, close events, multiple
  subscribers.
- **Delivered:**
