# T96: `Awaited`, `PromiseLike` and a sync result of `Promise<X> | X`

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found while delivering T91.
  - The structured-clone check does not understand `Awaited<...>` or `PromiseLike<...>`.
    `Awaited<Promise<X>>` in a result or a parameter is reported as a Promise, although it is `X`.
  - A sync signature whose result is `Promise<X> | X` passes the clone check (the Promise is the
    outermost type), but `isAsync` is false for it (T56), so the generated types and wrappers may not
    match what the handler returns.
- **Scope:** unwrap `Awaited` (and decide on `PromiseLike`) in the clone check; either support a
  result of `Promise<X> | X` in the generated code, or reject it with a clear error.
- **Tests:** parser tests of the clone issues; e2e fixtures that type-check the generated output.
- **Delivered:**
