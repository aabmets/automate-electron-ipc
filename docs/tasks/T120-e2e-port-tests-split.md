# T120: Split the e2e tests, part 1: ports

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** Over the limit in `tests/test_e2e/`: `utilityPorts.test.ts` (2078), `ports.test.ts`
  (1466), `portQueues.test.ts` (1125), `mainPorts.test.ts` (1106).
- **Scope:**
  - Split each file along its `describe` blocks into files of at most 300 lines, named after the
    area they cover, as `.claude/skills/module-structure` describes. Move shared builders and fakes
    to `tests/utils/`. Update every importer; Biome forbids barrel files.
  - Mirror the layout of the matching source modules if their split has landed.
- **Tests:** The number of tests (and of `it.fails` and `it.skip`) is the same before and after,
  with no assertion changed; the whole suite passes; `bun scripts/check-size.ts --update` lowers the
  baseline in the same commit.
- **Delivered:** 2026-10-09. `utilityPorts`, `ports`, `portQueues` and `mainPorts` of `tests/test_e2e` are
  now 32 files of at most 288 lines (with header), split along their describe blocks, with the shared
  fakes and loaders in `tests/utils/port-connect-utils.ts`, `utility-port-utils.ts`, `port-queue-utils.ts`
  and `main-port-utils.ts`. 304 tests before and after with identical titles, none skipped, no assertion
  changed. The four baseline entries are removed.
