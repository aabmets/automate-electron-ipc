# T84: An `ask` never settles when the asked page reloads, navigates or crashed

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the review of 2026-10-09, in Electron 44. The generated `ask` helper settles
  a pending question only on `'destroyed'` and `'render-process-gone'` of the contents, or on its
  timeout, which is off by default.
  - A reload of the window, or a navigation of the frame that was asked, replaces the document
    that would answer. The contents live on, so neither event fires: the promise never settles
    and its `pendingAsks` entry stays.
  - A renderer that crashed before the question was asked: the check of a target that is gone
    reads `isDestroyed()` only, and the `'render-process-gone'` already fired, so the question
    waits forever.
- **Scope:**
  - Reject a pending question with `IPC_ASK_DESTROYED` (or a new documented code) when the
    document it was sent to is replaced: for the contents, a main-frame `did-navigate` that is not
    same-document; for a frame target, the `did-frame-navigate` of that frame (by `frameProcessId`
    and `frameRoutingId`). Listening to the commit, and not to the start, lets the old document
    answer while a navigation is pending, and covers a navigation that `beforeunload` cancels.
  - Treat `contents.isCrashed()` as gone in the up-front check.
  - The README and T23's note on frames that go away must say what is true.
- **Tests:** the `it.fails` scenarios `askedPageGoesAway` and `askCrashedRenderer` of
  `tests/test_electron/asks.test.ts` turn into passing tests, and runtime tests with fakes cover
  the same paths, with fakes that keep the contents alive across a navigation.
- **Delivered:**
