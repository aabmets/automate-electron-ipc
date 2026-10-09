# T86: Calls to a utility process that exited before the bindings saw it hang forever

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the review of 2026-10-09, in Electron 44. The bindings listen for the
  `'exit'` of a child from its first use (`getUtilityPeer`, `connectUtilityPort`), or from
  `attachUtility`, which is optional. A child that exited before is never marked as closed, and
  Electron drops what is posted to it without an error. So `ipc.<name>.invoke(child)` never
  settles, `send` does not throw, and a page connected to it with `connect(child, win)` waits
  forever. The README promises `IPC_UTILITY_EXITED` for "any later call or send".
- **Scope:**
  - Find a way to tell that a child has exited. `pid` is `undefined` both before the spawn and after
    the exit, so the state cannot be read afterwards. Options: a generated `forkUtility()` that
    attaches at once; make `attachUtility(child)` required right after `utilityProcess.fork` and
    reject a child that was never attached; or both. Ask the user if the choice changes the API.
  - Calls, sends and `connect` of a child that exited fail with `IPC_UTILITY_EXITED`.
  - The README says what to call, and when.
- **Tests:** the `it.fails` of `tests/test_electron/utility.test.ts` (`exitedBeforeFirstUse`) and
  of `tests/test_electron/utilityPorts.test.ts` (`connectExitedChild`) turn into passing tests.
- **Decision (answered by the user, 2026-10-09):** add a generated `forkUtility()` wrapper which calls
  `utilityProcess.fork` and attaches the child at once, so that its `'exit'` is seen from the start.
  `attachUtility(child)` stays for children forked elsewhere, and must be called right after the
  fork. A child that was never attached (by either) is rejected with a clear error instead of hanging.
  Calls, sends and `connect` to a child that exited fail with `IPC_UTILITY_EXITED`. The README says
  what to call and when.
- **Delivered:** 2026-10-09. `forkUtility(...args)` (the arguments of `utilityProcess.fork`) and an
  idempotent `attachUtility(child)` in `main.ts`; the peer of a child is no longer made lazily. A child
  the bindings never saw fails with the new `IpcUtilityError` code `IPC_UTILITY_NOT_ATTACHED` (a
  rejection for `invoke`, a throw for `send`, `handle`, `on`, `once` and `connect`), and a child that
  exited fails with `IPC_UTILITY_EXITED`. Deviations: `connect` to an exited child throws
  `IPC_UTILITY_EXITED` itself (the scenario `connectExitedChild` now reads the code of that throw,
  not the code the page sees, since no port ever reaches the page); a schema with only
  `invokeUtility`/`streamUtility` channels now also gets the peers, `IpcUtilityError`, `forkUtility`
  and `attachUtility` in `main.ts`, since `connect` needs the exit state of the child; the electron
  runner's `ctx.fork` forks through `forkUtility` (`{ bindings: false }` for a raw fork). This is a
  breaking change for code that used a child without `attachUtility`. Not done: `attachUtility` cannot
  tell that a child exited before it was called (documented).
