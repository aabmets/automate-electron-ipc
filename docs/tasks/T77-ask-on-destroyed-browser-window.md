# T77: `ask` on a destroyed `BrowserWindow` throws a TypeError

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found by T75 in real Electron. The README says that an `ask` rejects with an
  `IpcAskError` that has the code `IPC_ASK_DESTROYED` when the target is destroyed. The generated
  `askRenderer` calls `resolveSendTarget(target)` first, which reads `target.webContents`. On a
  destroyed `BrowserWindow` that getter throws `TypeError: Object has been destroyed`, so the promise
  rejects with a `TypeError` that has no `code`. A `WebContents` or `WebContentsView` that is
  destroyed is handled (the `isDestroyed()` check), and a window which is destroyed while a question
  is pending is handled as well (the `destroyed` listener); only a window that was destroyed before
  the question fails. The unit tests use stand-ins whose `webContents` never throws.
  `tests/test_electron/asks.test.ts` has this as an `it.fails` that refers to this task.
- **Scope:** resolve the target inside the same guard that produces `IPC_ASK_DESTROYED`: a target
  whose `isDestroyed()` is true, or whose `webContents` getter throws, rejects with the `IpcAskError`.
  Check what the other verbs do with a destroyed `BrowserWindow` (`emit`'s `send`, `connect` of the
  port verbs, `stream`) and say in the README what is promised for each; throwing Electron's error is
  fine for the verbs that return nothing, if it is written down.
- **Tests:** flip the `it.fails` of `tests/test_electron/asks.test.ts` to `it`. A unit test with a fake
  window whose `webContents` getter throws after `destroy()`.
- **Delivered:** 2026-10-08. `askRenderer` now resolves the target inside the `try` that produces `IPC_ASK_DESTROYED`:
  a target whose own `isDestroyed()` is true (a `BrowserWindow`), or whose `webContents` getter,
  `fromFrame` or `isDestroyed` throws, rejects with the `IpcAskError`. The `it.fails` of
  `tests/test_electron/asks.test.ts` is an `it` (checked in Electron), and the unit tests have a fake
  window whose getter throws after `destroy()`, and one whose getter throws while `isDestroyed()` is
  false. Other verbs: `emit`'s `send` and `connect` of the port verbs throw Electron's own
  `TypeError` for a destroyed window, which the README now says. Note: `connectPorts` registers the
  first window in `portEnds` before it reads the second one's `webContents`, so a destroyed second
  window leaves that entry behind when `connect` throws; this became T78.
