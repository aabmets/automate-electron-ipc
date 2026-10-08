# T04: Rest parameters lose their spread in generated call sites (B4)

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `getOriginalParams(spec, true)` drops `...`. `(...values: number[])` generates
  `webContents.send('X', values)`, so the renderer receives a single array argument.
- **Scope:** emit `...name` for rest params at every call site (main senders, and anywhere else
  `onlyNames` is used).
- **Tests:** writer unit tests for rest, optional and destructured params, plus an e2e test.
- **Delivered:**
