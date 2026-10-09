# T87: Listeners that grow with each call, stream, connection or registration

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the review of 2026-10-09, in Electron 44.
  - Every pending `ask` adds a `'destroyed'` and a `'render-process-gone'` listener of its own to the
    contents, every open stream a `'destroyed'` listener, and every `connect` of a `mainPort`,
    `port` or brokered utility channel a `'destroyed'` listener and four load listeners
    (`watchPageLoad`), plus an `'exit'` listener on the child. More than ten at once, which is
    normal use, makes Node print `MaxListenersExceededWarning` in the main process.
  - A handler registered with the `webContents` option (T34) keeps its remover in the record of the
    contents when a newer `handle` replaces it, until the contents are destroyed. The remover
    holds the replaced callback, so re-registering per load grows without bound.
- **Scope:**
  - One listener per contents (and per child) for each event, with a set of callbacks inside, in
    the shape of `contentsIpcRegistry`.
  - Replacing a scoped handler releases the registration it replaced.
  - Check the worker `ask` helper and the preload side (`ipcRenderer` listeners of `on`) for the
    same shape.
- **Tests:** the `it.fails` of `tests/test_electron/asks.test.ts` (`manyAsksAtOnce`),
  `tests/test_electron/streams.test.ts` (`manyStreams`), `tests/test_electron/ports.test.ts`
  (`manyConnections`) and `tests/test_e2e/contentsHandlers.test.ts` (a replaced handler is
  released) turn into passing tests.
- **Delivered:** 2026-10-09. A generated `watchEvent(emitter, event, callback)` keeps one listener per emitter and
  event, with the callbacks of all watchers behind it (a `WeakMap` keyed by the emitter; the listener is
  added with the first watcher and removed with the last; a callback that throws is logged and does
  not stop the others). `askRenderer` (`destroyed`, `render-process-gone`, `did-navigate` or
  `did-frame-navigate`), `startStream` (`destroyed`), `watchPageLoad` (the four load events),
  `connectPorts` (`closed` of the window), `connectMainPort` and `connectUtilityPort` (`destroyed`) and
  the `'exit'` of the child in `connectUtilityPort` use it, so 12 asks, streams or connections add one
  listener of each event, not twelve. The helper is written only for a schema with such channels.
  Replacing a handler registered with the `webContents` option now releases the registration it
  replaced: `watch(remove, channel)` drops the remover of the replaced one from the record of the
  contents. Not changed, on purpose: `resolveIpcTarget` and `registerScope` already add one
  `destroyed` listener per contents; `attachUtility` adds one `'exit'` per child; the worker `ask`
  helper registers once per worker and per session and holds pending asks in a table, so it has no
  listener per call. The preload `on`/`once` of a `send` channel still adds an `ipcRenderer` listener
  per subscription (the page owns them and each disposer removes its own), so more than ten
  subscribers to one channel can still print the warning in the renderer; a follow-up could share
  one `ipcRenderer` listener per channel.
