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
- **Delivered:** 2026-10-08. Both helpers share a generated `watchPageLoad(contents, onLoad)`. The page counts as
  loaded from every `did-finish-load`, and from the `did-stop-loading` of a load that `did-finish-load`
  has not reported (the call right after `await loadURL()`), once per load. `isLoadingMainFrame()` is
  also `true` at both moments, so it was no alternative (measured in Electron 44). A failed main-frame
  load (`did-fail-load`), a subframe navigation and a same-document navigation do not count, so a
  frame that navigates does not re-pair the page. Deviation: in the reload scenario the page of the
  peer that stays hears `close` before the second `ready`, since the old port closes with the old
  document (the designed behavior of `onClose`), so the expectation of the `it.fails` was corrected.
  The six `it.fails` are `it` now, the fakes report `isLoading()` as `true` at `did-finish-load`
  (`startLoading`/`finishLoading` in `tests/utils/runtime-utils.ts`), and the fakes of two tests got
  `isDestroyed`.
