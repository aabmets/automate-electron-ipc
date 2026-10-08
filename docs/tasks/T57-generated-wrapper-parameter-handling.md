# T57: Parameter names clash with generated names; event injection

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the 2026-10-08 code review.
  - `emit<(browserWindow: number) => void>()` generates
    `(browserWindow: BrowserWindow, browserWindow: number)` (TS2300). `event` and `callback` can
    clash the same way in the main-process wrappers.
  - `injectEventTypehint` inserts the event parameter at the first `(` of the signature text, which
    breaks generic signatures such as `<T extends (x: number) => void>(cb: T) => void`.
- **Scope:** pick generated parameter names that cannot clash with user parameter names. Insert the
  event parameter at the start of the parameter list found from the AST, not by text search.
- **Tests:** writer unit tests, plus an e2e fixture that type-checks.
- **Delivered:**
