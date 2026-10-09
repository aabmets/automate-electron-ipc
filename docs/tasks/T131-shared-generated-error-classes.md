# T131: Share the generated error classes and reply readers

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** The writers emit near-identical runtime code: `IpcAskError` and `readAskReply`
  (`src/writer/main/main-asks.ts`) and `IpcUtilityError` and `readUtilityReply`
  (`src/writer/utility/utility-peer.ts`) differ only in names and an error code, and the timer
  clamp `Math.min(timeoutMs, 2147483647)` is spelled out seven times across the main, preload and
  utility writers.
- **Scope:** One parametrised builder for the error class and one for the reply reader in a new
  `src/writer/` module, and a constant for the largest timer delay. The other `Ipc*Error`
  classes differ in shape; leave them.
- **Tests:** The generated output of every fixture is byte-identical (`diff -r`), so no
  exact-output test changes.
- **Delivered:**
