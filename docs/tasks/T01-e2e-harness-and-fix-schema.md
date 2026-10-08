# T01: E2E harness, and fix schema-dir crash on Node (B1)

Phase 0: Declaration syntax and test infrastructure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `src/automation.ts` calls `fsp.exists`, which exists only in Bun. Under Node the
  documented `schema/` directory mode throws `TypeError: fsp.exists is not a function`.
  `automation.ts` has no tests at all.
- **Scope:**
  - Remove the `fsp.exists` call; `stat` already proves the file exists.
  - Add `tests/test_e2e/`. It contains fixture projects under `tests/fixtures/` (a single
    `schema.ts`, and a `schema/` directory with nested files). A helper copies a fixture into a temp
    dir, runs `ipcAutomation` with the cwd/project root pointed at it, and returns the three
    generated files.
  - Add a type-check helper that compiles the generated `main.ts`, `preload.ts` and `window.d.ts`
    against the repo's pinned `electron` types (tsc `--noEmit`, with a tiny tsconfig in the temp
    dir).
- **Tests:**
  - Regression: directory mode runs under Node (vitest runs on Node).
  - The e2e test for each fixture produces files that type-check.
  - Tests may be marked `it.fails`/`todo` for B2–B7 until those tasks land, with a comment
    referencing the task.
  - Fixtures use the T00 syntax.
- **Delivered:**
