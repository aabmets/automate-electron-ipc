# T91: A Promise nested in a result is not reported

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the review of 2026-10-09. The structured-clone check (T19) reports a Promise
  in a parameter, but in the result it allows any Promise, not only the one of an async
  signature. `() => Promise<{ avatar: Promise<string> }>`, `() => Promise<number>[]` and
  `() => { avatar: Promise<string> }` generate without an error, and Electron cannot clone the
  result. A `WeakMap` in the same place is reported.
- **Scope:** allow a Promise only as the outermost type of the result (and in a union of it with the
  sync type), and report one anywhere below it, for every verb that has a result.
- **Tests:** the `it.fails.each` of `tests/test_parser/cloneIssues.test.ts` turns into a passing
  `it.each`.
- **Delivered:**
