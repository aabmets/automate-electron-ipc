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
- **Delivered:** 2026-10-09. Deviations and notes:
  - `timeoutMs` is an option of `callUtility`, `callMain`, `invokeUtility` and `streamUtility`
    (a non-negative integer literal, `0` for none). The shared `callUtilityPeer` takes it as an
    optional last argument, so `main.ts` and `utility.ts` get the same timer. A timed-out call is
    rejected with an `IpcUtilityError` of the code `IPC_UTILITY_TIMEOUT`, the pending entry is
    removed, so the late reply finds no call and is dropped; the handler is not stopped. The timer
    is cleared on a reply, an error, a send failure and when the peer closes.
  - The default `timeoutMs` of the config applies to the three call verbs, as for `invoke`, but not
    to `streamUtility`, which times out only through its own option. The task did not say; a
    default meant for calls would otherwise cut every stream that starts slowly.
  - Pages: `invokeUtility` rejects with the plain object `{ name: 'IpcUtilityError', message, code }`.
    The timer starts when the page makes the call, so it covers the wait for the port too, and a
    call that timed out while waiting is never sent. `window.d.ts` lists `IPC_UTILITY_TIMEOUT` among
    the codes of `IpcUtilityError`.
  - `streamUtility` times only the wait for the first chunk, the end or an error. A timed-out stream
    posts `cancel` to the child (which stops the generator) and fails the read. A stream that has
    begun is not cut short, since backpressure pauses the generator on purpose, so there is no idle
    timeout between chunks. A generator that is stuck in an `await` is stopped only when it resumes
    (as noted in T30).
  - Decision: no `invokeWith(child, { timeoutMs }, ...)`. The caller of `callUtility` is the main
    process, which can set the option in the schema; a per-call value can be added later if a use
    appears.
  - Tests: parser, validators, the writers, runtime tests with fake timers on all three ends
    (`tests/test_e2e/utilityTimeouts.test.ts`, fixture `utility-timeouts`), and real-Electron
    scenarios `timeouts` in `utility.test.ts` and `utilityPorts.test.ts` with hanging handlers.
