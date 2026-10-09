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
- **Delivered:** 2026-10-09. `tests/validators.test.ts` (1694 lines, 391 tests) is now ten files in `tests/test_validators/`, 141 to 248 lines each: config (`config.options`, `config.features`), channel specs (`channelSpecs`, `.streams`, `.scopesAndTimeouts`, `.guards`, `.utility`, `.serviceWorkers`), `global` and `cloneWarnings`. The 391 tests are unchanged (no `it.fails` or `it.skip`), and no helper needed to move. The paths in the `vitest-conventions` skill and in T98 were updated.
