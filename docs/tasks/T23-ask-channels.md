# T23: `ask` channels (main asks a renderer and awaits the answer)

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** Electron has no invoke from main to a renderer. A real need is "unsaved changes?" on
  `close`/`before-quit`, or fetching editor state before save.
- **Scope:**
  - New verb `ask<Sig>(config?)`; the `as` form from T00 also works.
  - The main side gets `ipc.<name>.invoke(target, ...args, { timeoutMs? }): Promise<R>`. Each
    request carries a correlation ID over `send`; the renderer replies on a reply channel with the
    same ID. (Not a per-request `MessageChannelMain`: that is reserved for T27's long-lived
    streams.)
  - Reject on timeout, on target destroyed, and when the renderer has no handler registered.
  - The renderer side gets `ipc.<name>.handle(cb)` with a disposer, single responder.
  - Errors use T18's envelope.
- **Tests:** runtime tests with both sides mocked: success, timeout, destroyed target, handler error,
  concurrent requests resolved out of order.
- **Delivered:**
