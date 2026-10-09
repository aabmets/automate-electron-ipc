# T117: Split `tests/validators.test.ts`

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `tests/validators.test.ts` is 1714 lines.
- **Scope:**
  - Split each file along its `describe` blocks into files of at most 300 lines, named after the
    area they cover, as `.claude/skills/module-structure` describes. Move shared builders and fakes
    to `tests/utils/`. Update every importer; Biome forbids barrel files.
  - Group by validator (config, channel specs, clone warnings, global validation).
  - Mirror the layout of the matching source modules if their split has landed.
- **Tests:** The number of tests (and of `it.fails` and `it.skip`) is the same before and after,
  with no assertion changed; the whole suite passes; `bun scripts/check-size.ts --update` lowers the
  baseline in the same commit.
- **Delivered:**
