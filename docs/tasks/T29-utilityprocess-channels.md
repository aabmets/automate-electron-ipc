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
- **Delivered:**
