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
- **Delivered:** 2026-10-08. Deviations and notes:
  - Deviation: the options are not a trailing argument. `ipc.<name>.invoke(target, ...args)` has none,
    and `ipc.<name>.invokeWith(target, { timeoutMs }, ...args)` takes them before the arguments. A
    trailing object is swallowed by optional or rest parameters of the signature (the reason T21 made
    `broadcastTo` a separate method). There is no timeout by default, as in the task text.
  - `ask` takes no config options, and no error types: the errors come from the renderer. Under the hood
    it is `Unicast` / `MainToRenderer`, and the validators tell it apart from `invoke` by the direction.
  - The request is `send(wire, id, ...args)` and the reply `ipcMain.on('<wire>:reply', (event, id,
    envelope))`. The reply channel cannot be the wire name of another channel, since schema names have
    no colon. The reply listener is registered at the first question of a channel, and ignores a reply
    unless the ID is pending for that reply channel and `event.sender` (and, for a frame target,
    `event.senderFrame`, compared by object or by process and routing ID) is who was asked.
  - Targets are those of `emit`'s `send`. A frame target is also tied to its contents through
    `webContents.fromFrame`, when Electron knows them. A frame has no destroy event of its own, so a
    frame that goes away after the question is caught by the destruction of its contents or the timeout.
  - Rejection is always an `IpcAskError` (`channel`, `code`, `data`, and the `name` of the renderer's
    error), with the codes `IPC_ASK_TIMEOUT`, `IPC_ASK_DESTROYED`, `IPC_ASK_NO_HANDLER` and
    `IPC_ASK_INVALID_REPLY`. The preload script also answers `IPC_ASK_UNSENDABLE` for an answer that
    cannot be cloned. A destroyed target and a failing send reject the promise, and do not throw.
  - The preload script listens for the questions from the start and keeps the responders (a
    contextBridge callback is a new proxy at each crossing), so it can answer `IPC_ASK_NO_HANDLER` at
    once. T18's envelope and `toIpcError` are copied into the preload script, not shared, and apply
    whatever `rawErrors` says. Through `contextBridge`, an `Error` thrown by the page loses its `name`,
    `code` and `data`, so the README tells responders to throw a plain object (assumed from T18's
    check of the other direction, not checked here).
  - `main.ts` declares `resolveSendTarget` for asks, and `broadcastMessage` and `sendToSenderFrame` only
    when an `emit` exists. `Awaited`, `TypeError`, `setTimeout`, `clearTimeout` and the new helper names
    are reserved in `main.ts`.
  - Not checked against a running Electron here: both sides are covered with fakes, and a test joins the
    generated main process and preload script through them.
