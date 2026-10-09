# T95: Edge cases of the page-load watch left after T85

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found while delivering T85, which resets the watch only when a main-frame navigation
  commits (`did-navigate`).
  - Between the start of a navigation and its commit, the old page still counts as loaded, so a
    `connect` in that window pairs a document that is about to be replaced. The new load pairs again.
  - A watch that starts while a failed load is in flight (its `did-fail-load` fired before the watch
    began) takes the `did-finish-load` of the error page for a load.
  - A main-frame `ERR_ABORTED` after a commit (for example `webContents.stop()` while the new document
    loads) leaves `failed` set, so the committed page never counts as loaded until the next navigation.
- **Scope:** decide for each case whether to change the watch, and fix the ones that are worth it.
  Keep one listener per contents and event (`watchEvent`, T87).
- **Tests:** unit tests with the fakes of `tests/utils/runtime-utils.ts`; a real-Electron scenario for
  each case that changes behavior.
- **Delivered:** 2026-10-09. Changed the third case only: an ERR_ABORTED (-3) after a main-frame
  commit (`webContents.stop()` while the document arrives; Electron fires `did-navigate`,
  `did-fail-load` -3 and `did-stop-loading`, no `did-finish-load`) no longer sets `failed`, so the
  `did-stop-loading` counts as the load of the document that committed. `watchPageLoad` keeps a
  `committed` flag for that; an ERR_ABORTED before any commit still sets `failed`. Left as-is: the
  first case (a `connect` between the start and the commit of a navigation pairs the old page, and
  the commit then pairs the new one), since the watch cannot know whether the navigation will commit,
  and waiting for it would hold back the old page for as long as a slow navigation takes, with the same
  final state; and the second case (a watch that begins between `did-fail-load` and the error page's
  `did-finish-load`), since Electron 44 shows nothing that tells the error page apart: `getURL()` and
  `mainFrame.url` are the failed URL, and `mainFrame.origin` is `"null"` for custom schemes as well.
  Real-Electron scenario: `mainPortStoppedAfterCommit` (`ports.test.ts`).
