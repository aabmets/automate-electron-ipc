# T93: Review of the source and the tests

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** a review of the source and the tests (2026-10-09), asked for by the user: hunt for
  bugs, make sure that the tests are valid and that no mock defeats the purpose of its test, and
  cover the real Electron use cases that the integration tests miss (that part is T83).
- **Scope:**
  - Record each confirmed bug as a task, with a test that fails today: `it.fails` real-Electron
    scenarios for the generated runtime code (as `CLAUDE.md` asks), and `it.fails` unit or e2e
    tests for the generator. The bugs are not fixed here.
  - Fix the tests that are invalid, flaky or weaker than they look.
- **Tests:** what the delivery note lists.
- **Delivered:** 2026-10-09.
  - New tasks T84 to T92, with `it.fails` tests that were checked to fail for the reason that each
    task states (by running them as `it`): the runtime ones in `tests/test_electron/asks`, `ports`,
    `streams`, `utility`, `utilityPorts` and `tests/test_e2e/contentsHandlers`; the generator ones in
    `tests/test_e2e/generatorFindings.test.ts` and `tests/test_parser/cloneIssues.test.ts`.
  - Flaky: a fixed 20 ms `settle` of nine e2e files could resolve before the real `MessagePort`s
    of Node delivered anything, when the process was descheduled for longer (the timer phase of the
    next turn runs before its poll phase). Reproduced under CPU load; `settlePorts` of
    `runtime-utils.ts` also waits for a few rounds of immediates. 0 failures in 24 loaded runs,
    where it failed within 12 before. Five tests that run tsc two or three times get 60 s.
  - Tests that could not fail, found by mutating the writers: the two "ignores a credit which does
    not raise the limit" tests sent the low credits while the stream was paused, and one test
    asserted `toBeDefined()` on the `close` of a fake port. Both now catch the mutation.
  - Fakes that hid real behavior: the `contextBridge` fake handed the page the very object it got,
    and allowed a key twice; it now copies, and throws as Electron does. The `invoke` fake of a
    service worker resolved `undefined` without a handler and passed the thrown error through; it
    now rejects with Electron's own `Error invoking remote method` error, which showed that a test
    expected an `IpcSerializationError` instance where Electron delivers a wrapped `Error`.
  - Real Electron: `sendToSender` to an iframe and a stream opened by an iframe were tested with
    fakes only; both have scenarios now, which catch a mutation of the frame target. Five
    Electron test files check now that every scenario finished without uncaught errors, and the
    runner reports the `preload-error` of a window, which nothing saw before.
  - Not filed, unconfirmed: a handler result that cannot be cloned rejects an `invoke` with
    Electron's error and not the envelope; a message that waits in the queue of a port and cannot
    be cloned fails at the flush with `console.error` only; the README still says that utility
    calls have no `timeoutMs` (T79 added it), which the README rewrite (T48) should fix.
