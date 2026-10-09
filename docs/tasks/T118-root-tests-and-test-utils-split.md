# T118: Split the root tests and the test utilities

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** Over the limit: `tests/automation.test.ts` (631), `tests/config.test.ts` (581),
  `tests/types.test.ts` (345), `tests/utils.test.ts` (332), and in `tests/utils/`:
  `electron-utils.ts` (471) and `electron-runner.cjs` (382).
- **Scope:**
  - Split each file along its `describe` blocks into files of at most 300 lines, named after the
    area they cover, as `.claude/skills/module-structure` describes. Move shared builders and fakes
    to `tests/utils/`. Update every importer; Biome forbids barrel files.
  - Mirror the layout of the matching source modules if their split has landed.
  - `electron-runner.cjs` is loaded by the `electron` binary, and the scenarios are turned into text
    and run there (see `CLAUDE.md`): after splitting the runner and `electron-utils.ts`, run `bun
    run test:electron` with the binary, not only the skip path.
- **Tests:** The number of tests (and of `it.fails` and `it.skip`) is the same before and after,
  with no assertion changed; the whole suite passes; `bun scripts/check-size.ts --update` lowers the
  baseline in the same commit.
- **Delivered:** 2026-10-09. `tests/automation.test.ts` is five files in `tests/test_automation/`,
  `config.test.ts` four in `tests/test_config/`, `types.test.ts` two in `tests/test_types/` and
  `utils.test.ts` three in `tests/test_utils/` (175 tests before and after, no assertion changed).
  `electron-utils.ts` gave `electron-support.ts`, `electron-process.ts` and `electron-compile.ts`.
  `electron-runner.cjs` gave `electron-context.cjs` and `electron-pages.cjs`, which the harness copies
  next to the runner; `routes` is cleared instead of replaced, and a relative URL in
  `paths.test.ts` got one more `../`. `bun run test:electron` ran with the binary: 214 tests before and
  after. `tests/test_electron/harness.test.ts` is at 289 lines (soft limit) and is T119's.
