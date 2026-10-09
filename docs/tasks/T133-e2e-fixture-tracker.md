# T133: One fixture tracker for the e2e tests

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** 47 files in `tests/test_e2e/` declare `let project: E2EProject | undefined` with an
  `afterEach` that cleans it up; ten helpers in `tests/utils/e2e/` keep the same state, and
  `generateFixture` is defined three times (`ask-utils`, `runtime-main-utils`,
  `stream-main-utils`). The serializer helpers use a third form, a `track(project)` callback.
- **Scope:** `useFixtures()` in a new `tests/utils/fixture-tracker.ts` (`e2e-utils.ts` is at the
  soft limit): it registers its own `afterEach`, cleans every project it ran, and returns
  `run(name, options)`. Replace the three `generateFixture` copies, the `cleanup*` helpers and the
  per-file state. If one commit is too large, split into `T133a` (helpers) and `T133b` (tests).
- **Tests:** Same test count, no assertion changed; no temp dir left behind after a failing test.
- **Delivered:**
