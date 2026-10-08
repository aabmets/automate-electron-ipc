# T56: Async return type detection is a prefix match

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the 2026-10-08 code review. `parseSignature` sets
  `async: returnType.startsWith("Promise")`. A return type such as `PromiseResult` (a user type)
  or `PromiseLike<T>` counts as async, so `window.d.ts` types `invoke` senders as
  `() => PromiseResult` although `ipcRenderer.invoke` always returns a `Promise`.
- **Scope:** decide async from the AST: the return type is a `TsTypeReference` named exactly
  `Promise`. Renderer senders of `invoke` channels always return `Promise<Awaited<R>>`.
- **Tests:** parser and writer unit tests, plus an e2e type-check.
- **Delivered:** 2026-10-08. A return type that is exactly the global `Promise<...>` (parentheses allowed) keeps the written definition in `window.d.ts`; every other invoke return type becomes `Promise<Awaited<R>>`. Follow-up: rebuilding a non-async invoke signature drops its type parameters, so generic signatures need T57's handling.
