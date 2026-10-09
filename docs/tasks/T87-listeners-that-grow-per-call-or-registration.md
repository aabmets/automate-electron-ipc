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
- **Delivered:**
