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
- **Delivered:** 2026-10-09. `tests/utils/fixture-tracker.ts` has `createFixtureTracker()` (run, current, cleanup), `trackFixtures(scope)`, which registers its own `afterEach` (or `afterAll` with `"file"`, for the `beforeAll` project of the port queue tests), and `fixtures`, the tracker that a test file and its helpers share, so `fixtures.run(name)` is all a test needs. Deviation: the hook is `trackFixtures`, not `useFixtures`, because Biome's `useHookAtTopLevel` reads `use*` as a React hook. 54 test files and the ten helpers lost their `let project`, `afterEach` cleanup and `generateFixture` / `cleanupRuntime` / `disposeContentsFixture` / `disposeScopesFixture` copies; the `track(project)` callbacks of the loaders became `run` arguments. The cleanups that also restore mocks or close ports (`cleanupStreams`, `cleanupAsks`, `cleanupMainPorts`, ...) stay, minus the project lines. `tests/test_electron` keeps its own `project.cleanup()` calls (out of scope). 3298 tests (4 new, for the tracker), no assertion changed, no temp dir left behind.
