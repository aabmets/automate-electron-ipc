# T29: utilityProcess channels

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `utilityProcess` is Electron's recommended home for CPU-heavy or crash-prone work
  (SQLite, indexing, native modules). It only has untyped `postMessage`/`parentPort`, with no
  request/response.
- **Scope:**
  - New directions `MainToUtility` and `UtilityToMain`, with Broadcast and Unicast (correlation IDs).
  - A new generated file `utility.ts` for the child, on `process.parentPort`.
  - Typed wrappers in `main.ts` around a `UtilityProcess` instance.
  - Configurable output path.
- **Tests:** runtime tests with mocked `parentPort` and `UtilityProcess`: request/response, errors,
  exit while pending.
- **Delivered:** 2026-10-08. Deviations and notes:
  - Four verbs, with no options: `callUtility` (MainToUtility, Unicast), `notifyUtility`
    (MainToUtility, Broadcast), `callMain` (UtilityToMain, Unicast) and `notifyMain` (UtilityToMain,
    Broadcast). The task named only the directions. A Broadcast signature must return `void`, like
    the others. The error-type argument of `invoke` and the options `allowedOrigins`, `validate` and
    `timeoutMs` do not apply (T79 adds timeouts).
  - Main: `invoke(child, ...args)` and `send(child, ...args)` for the calls to the child, and
    `handle(child, callback)`, `on(child, callback)` and `once(child, callback)` for the messages of
    the child. State is per `UtilityProcess` (a `WeakMap`), created when a channel first uses the
    child, or by the exported `attachUtility(child)`. A child that calls first would otherwise not be
    answered. The `exit` event rejects the pending calls, and the later calls and sends, with
    `IPC_UTILITY_EXITED`.
  - Child: the generated `utility.ts` has `handle`, `on`, `once`, `invoke` and `send` on
    `process.parentPort`, found through `globalThis` so that the file type-checks without Node types
    and can be imported anywhere. It throws a `TypeError` when a channel is used outside a utility
    process.
  - Protocol: plain objects tagged with `__ipc` (`send`, `call`, `reply`) with the envelope of
    `invoke`. Errors are an `IpcUtilityError` class (the ends are Node processes, so no
    `contextBridge`), with the codes `IPC_UTILITY_EXITED`, `_NO_HANDLER`, `_UNSENDABLE` and
    `_INVALID_REPLY`. The same peer code is emitted into both files (`utility-runtime.ts`). `rawErrors`
    does not apply.
  - Config `utilityBindingsPath` (relative to the project root, a `.ts` file, not the path of another
    generated file) sets the output path, which defaults to `utility.ts` in `ipcDataDir`. The file is
    written only when the schema has a utility channel. The preload script and `window.d.ts` skip the
    utility channels, and are the empty files for a schema that has only those.
  - Tests include a real-Electron group (`tests/test_electron/utility.test.ts`) that forks real
    utility processes. `ctx.fork(fn)` was added to the harness.
  - Follow-ups: T79 (timeouts) and a line in T43 (a stale `utility.ts` is not removed). Not done:
    one `utility.ts` serves all children, so two child scripts cannot have different channel sets
    (the unused ones answer `IPC_UTILITY_NO_HANDLER`), and a utility process cannot call another one.
