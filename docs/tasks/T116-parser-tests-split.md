# T116: Split the parser tests

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** Over the limit in `tests/test_parser/`: `parseChannelMap.test.ts` (1472),
  `parseSpecs.test.ts` (855), `cloneIssues.test.ts` (551), `parseImportDeclarations.test.ts` (321),
  `parseTypeDefinitions.test.ts` (304).
- **Scope:**
  - Split each file along its `describe` blocks into files of at most 300 lines, named after the
    area they cover, as `.claude/skills/module-structure` describes. Move shared builders and fakes
    to `tests/utils/`. Update every importer; Biome forbids barrel files.
  - `cloneIssues.test.ts` holds `it.fails` tests that point at tasks; they keep their task IDs and
    stay `it.fails`.
  - Mirror the layout of the matching source modules if their split has landed.
- **Tests:** The number of tests (and of `it.fails` and `it.skip`) is the same before and after,
  with no assertion changed; the whole suite passes; `bun scripts/check-size.ts --update` lowers the
  baseline in the same commit.
- **Delivered:** 2026-10-09. The five files became 19 test files of at most 280 lines (641 tests before and after, no
  `it.fails` or `it.skip` in this directory, no assertion changed). Helpers moved to
  `tests/utils/{channel-map,clone-issues,import-specs,type-definitions}-utils.ts`. `parseImportDeclarations.test.ts` and
  `parseTypeDefinitions.test.ts` kept their names for the remaining blocks. The five baseline entries were removed.
