# T122: Split the e2e tests, part 3: automation, utility, scopes and handlers

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** Over the limit in `tests/test_e2e/`: `ipcAutomation.test.ts` (1111),
  `utility.test.ts` (959), `utilityTimeouts.test.ts` (673), `contentsHandlers.test.ts` (509),
  `scopes.test.ts` (495).
- **Scope:**
  - Split each file along its `describe` blocks into files of at most 300 lines, named after the
    area they cover, as `.claude/skills/module-structure` describes. Move shared builders and fakes
    to `tests/utils/`. Update every importer; Biome forbids barrel files.
  - `contentsHandlers.test.ts` holds `it.fails` tests that point at tasks; they keep their task IDs
    and stay `it.fails`.
  - Mirror the layout of the matching source modules if their split has landed.
- **Tests:** The number of tests (and of `it.fails` and `it.skip`) is the same before and after,
  with no assertion changed; the whole suite passes; `bun scripts/check-size.ts --update` lowers the
  baseline in the same commit.
- **Delivered:** 2026-10-09. `ipcAutomation`, `utility`, `utilityTimeouts`, `contentsHandlers` and `scopes`
  of `tests/test_e2e` are now 21 files of at most 276 lines (with header), split along their describe
  blocks, with the shared fakes in `tests/utils/generated-text-utils.ts`, `utility-process-utils.ts`,
  `utility-timeout-utils.ts`, `contents-handlers-utils.ts` and `scopes-main-utils.ts`. 237 tests before
  and after with identical titles, none skipped, no assertion changed. Deviation from the task text:
  `contentsHandlers.test.ts` had no `it.fails` tests, only a `(T87)` comment, which moved with its test.
  The five baseline entries are removed.
