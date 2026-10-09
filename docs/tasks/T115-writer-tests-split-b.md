# T115: Split the writer tests, part 2: renderer types, service workers, serializer, utility

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** Over the limit in `tests/test_writer/`: `renderer-types.test.ts` (845),
  `service-worker-bindings.test.ts` (667), `serializer.test.ts` (623), `utility-bindings.test.ts`
  (404).
- **Scope:**
  - Split each file along its `describe` blocks into files of at most 300 lines, named after the
    area they cover, as `.claude/skills/module-structure` describes. Move shared builders and fakes
    to `tests/utils/`. Update every importer; Biome forbids barrel files.
  - Mirror the layout of the matching source modules if their split has landed.
- **Tests:** The number of tests (and of `it.fails` and `it.skip`) is the same before and after,
  with no assertion changed; the whole suite passes; `bun scripts/check-size.ts --update` lowers the
  baseline in the same commit.
- **Delivered:** 2026-10-09. `renderer-types.test.ts` became six files (callables, ports-and-names,
  errors-and-timeouts, api-and-scopes, asks-and-streams, utility), `service-worker-bindings.test.ts`
  five (channels, timeouts, validation, preload, types), `serializer.test.ts` four (page-and-main,
  workers, utility, ports-and-names), and `utility-bindings.test.ts` keeps the main-process cases while
  the renderer cases moved to `utility-bindings.renderer.test.ts`. Shared fixtures went to
  `tests/utils/serializer-utils.ts`, `service-worker-writer-utils.ts` and `utility-writer-utils.ts`.
  The `getFileImportPath` block of the serializer file tested `ImportsGenerator`, not the serializer,
  so it moved to `imports-generator.paths.test.ts`. The 485 tests of `tests/test_writer` are the same
  before and after (no `it.fails` or `it.skip`); the four files left `size-baseline.json`.
