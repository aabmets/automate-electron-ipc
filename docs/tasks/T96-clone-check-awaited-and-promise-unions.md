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
- **Delivered:** 2026-10-09. The clone check (`src/parser.ts`) unwraps `Awaited<...>` (a Promise or `PromiseLike`, also nested and behind a local alias, but only at the outermost position, so `Awaited<Promise<{ a: Promise<X> }>>` is still reported) and treats `PromiseLike` like `Promise` (allowed as the result, reported elsewhere). A sync result of `Promise<X> | X` is supported, not rejected: the writers already type it as `Promise<Awaited<R>>`, which the new `promise-unions` fixture type-checks for `invoke` and `ask`; the only gap was `returnsVoid`, which now accepts `Promise<void> | void` so a `send` handler can be async.
