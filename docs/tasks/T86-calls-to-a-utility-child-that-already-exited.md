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
- **Decision needed:** may the fix make `attachUtility` required, or add a `forkUtility` wrapper?
- **Delivered:**
