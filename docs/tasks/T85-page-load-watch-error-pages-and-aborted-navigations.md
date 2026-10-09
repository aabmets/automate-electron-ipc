# T85: The page-load watch takes error pages and aborted navigations for loads

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the review of 2026-10-09, in Electron 44. `watchPageLoad` (T76) decides
  when the page of a `port`, `mainPort` or brokered utility connection is ready to be paired.
  - When a main-frame load fails, Electron fires `did-fail-load` and then a `did-finish-load` for
    its error page. `finish` does not look at the failure, so it pairs the error page: a `mainPort`
    fires `onReady`, and flushes its queue into a port that no page reads. The page that loads next
    gets `ready` and the queued messages are gone.
  - `did-start-navigation` resets the state of the load, so the `did-stop-loading` of a navigation
    that never commits (one that `will-navigate` prevents, as the Electron security checklist #13
    advises, a download, a 204 response) counts as a new load. The page that never left is paired
    again: a `mainPort` and both ends of a `port` see `close` and a second `ready`, and a pending
    `invokeUtility` call of the page is rejected with `IPC_UTILITY_EXITED: The connection was
    replaced`.
- **Scope:**
  - A failed load does not pair; the queue waits for the next load that succeeds.
  - Reset the state of the load only when a main-frame navigation commits (`did-navigate`, not
    same-document). A navigation that started and stopped without a commit changes nothing.
  - Keep the cases of T76: every `did-finish-load` of a committed document counts, and so does the
    `did-stop-loading` of a load that `did-finish-load` did not report.
- **Tests:** the `it.fails` of `tests/test_electron/ports.test.ts` (`mainPortFailedLoad`,
  `abortedNavigation`) and of `tests/test_electron/utilityPorts.test.ts` (`abortedNavigation`)
  turn into passing tests. The fakes of the unit tests fire the events in the order that Electron
  does, including the `did-finish-load` of an error page.
- **Delivered:**
