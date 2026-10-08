# T52: A schema with only `port` channels generates invalid code

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the 2026-10-08 code review. `main-bindings.ts` and `preload-bindings.ts`
  always write the joined callables followed by a comma. With no callables (only `port` channels),
  the output is `{\n   ,\n   ports: {...` and tsc fails with TS1136 in both files.
- **Scope:** omit the callables line when there are no callables, in every writer.
- **Tests:** writer unit tests on the text, plus an e2e fixture with only port channels that
  type-checks.
- **Delivered:**
