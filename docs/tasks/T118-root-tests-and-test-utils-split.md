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
- **Delivered:**
