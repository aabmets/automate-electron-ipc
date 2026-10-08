# T79: Timeouts for utility process calls

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in T29. A `callUtility` or `callMain` call whose handler never answers stays
  pending until the process exits. T28 added timeouts only to `invoke`, and the verbs for utility
  processes take no options.
- **Scope:**
  - A `timeoutMs` option of `callUtility` and `callMain` (a non-negative integer literal, `0` for none),
    and the global default `timeoutMs` of the config applies to them as well.
  - A timed-out call is rejected with an `IpcUtilityError` with the code `IPC_UTILITY_TIMEOUT`. The
    handler is not stopped, and its late reply is dropped.
  - Decide whether `invokeWith(child, { timeoutMs }, ...args)` is also needed for a timeout chosen by
    the caller, like `ask` has.
  - Found in T30: the same for `invokeUtility` and `streamUtility`, whose calls come from a page. A call
    whose handler never answers waits until the connection closes. The page is the caller, so the
    option is in the schema, and the page rejects with the plain object of `withTimeout`, code
    `IPC_UTILITY_TIMEOUT`; a timed-out stream is cancelled in the child.
- **Tests:** runtime tests with fake timers on both ends, and a real-Electron scenario with a hanging
  handler.
- **Delivered:**
