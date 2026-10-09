# T114: Split the writer tests, part 1: preload, imports and base writer

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** Over the limit in `tests/test_writer/`: `preload-bindings.test.ts` (1205),
  `imports-generator.test.ts` (1105), `base-writer.test.ts` (455).
- **Scope:**
  - Split each file along its `describe` blocks into files of at most 300 lines, named after the
    area they cover, as `.claude/skills/module-structure` describes. Move shared builders and fakes
    to `tests/utils/`. Update every importer; Biome forbids barrel files.
  - Mirror the layout of the matching source modules if their split has landed.
- **Tests:** The number of tests (and of `it.fails` and `it.skip`) is the same before and after,
  with no assertion changed; the whole suite passes; `bun scripts/check-size.ts --update` lowers the
  baseline in the same commit.
- **Delivered:** 2026-10-09. `preload-bindings.test.ts` became six files (`scopes`, `channels`, `ports`, `timeouts`, `streams`, `utility`), `imports-generator.test.ts` five (`schema-types`, `paths`, `directories`, `qualified`, `collisions`), and `base-writer.test.ts` keeps the base cases, with the colliding-types blocks in `base-writer.colliding-types.test.ts`. The 191 tests are the same before and after. No shared helper needed moving to `tests/utils/`: each `describe` block was self-contained. The three entries left the baseline.
