# T76: Port channels never pair while `isLoading()` is true

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found by T75 in real Electron. The generated `connectPorts` (`port` channels) and
  `connectMainPort` (`mainPort` channels) pair only when `!contents.isLoading() && getURL() !== ''`.
  In Electron `isLoading()` is still `true` while `did-finish-load` fires, and right after
  `await win.loadURL()` resolves; it turns `false` at `did-stop-loading`. The fakes of the unit tests
  return `false`, so nothing noticed. As a result:
  - a connection made before the windows loaded (the usual order: create windows, `connect`, then
    `loadURL`) never pairs, and a `mainPort` queue never flushes;
  - a connection made right after `await win.loadURL()` never pairs;
  - a reload does not pair the new page again, so the ports of a page that was reloaded stay dead.
  Pairing works only when `connect` is called after Electron stopped loading the page. T75 shows this
  in `tests/test_electron/ports.test.ts`: six scenarios are `it.fails` with a reference to this task.
  The same applies to the flush of the bounded queue (`maxQueue`) of a `mainPort`.
- **Scope:** pair from the `did-finish-load` handler without asking `isLoading()` (the event says that the
  page loaded), and decide for the call that comes right after a load: pair if the contents have a URL
  and are not loading, otherwise wait for `did-finish-load` or `did-stop-loading`, whichever comes
  first and only once per load. Check `isLoadingMainFrame()` as an alternative. Do the same in
  `connectMainPort`. Keep the generated code free of any dependency on this library.
- **Tests:** flip the six `it.fails` of `tests/test_electron/ports.test.ts` to `it` (connect before the
  load, connect right after `loadURL`, reload, for `port` and `mainPort`, and the flush of the bounded
  queue). Update the runtime tests with fakes whose `isLoading()` is `true` during `did-finish-load`,
  so that they cannot hide this again.
- **Delivered:**
