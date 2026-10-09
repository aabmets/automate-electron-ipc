# T121: Split the e2e tests, part 2: streams, asks and runtime

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** Over the limit in `tests/test_e2e/`: `streams.test.ts` (1838), `runtime.test.ts`
  (1334), `asks.test.ts` (1333).
- **Scope:**
  - Split each file along its `describe` blocks into files of at most 300 lines, named after the
    area they cover, as `.claude/skills/module-structure` describes. Move shared builders and fakes
    to `tests/utils/`. Update every importer; Biome forbids barrel files.
  - Mirror the layout of the matching source modules if their split has landed.
- **Tests:** The number of tests (and of `it.fails` and `it.skip`) is the same before and after,
  with no assertion changed; the whole suite passes; `bun scripts/check-size.ts --update` lowers the
  baseline in the same commit.
- **Delivered:** 2026-10-09. `streams`, `runtime` and `asks` of `tests/test_e2e` are now 25 files of at
  most 272 lines (with header), split along their describe blocks, with the shared builders in
  `tests/utils/stream-main-utils.ts`, `stream-preload-utils.ts`, `stream-real-utils.ts`,
  `runtime-main-utils.ts`, `runtime-validation-utils.ts` and `ask-utils.ts`. 276 tests before and after
  with identical titles, none skipped, no assertion changed. The Biome override for the stream tests
  in `biome.json` now matches the new file names. The three baseline entries are removed.
