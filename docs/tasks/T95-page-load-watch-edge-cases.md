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
- **Delivered:**
