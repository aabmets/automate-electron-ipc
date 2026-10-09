# T113: Split `tests/test_writer/main-bindings.test.ts`

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `tests/test_writer/main-bindings.test.ts` is 2569 lines.
- **Scope:**
  - Split each file along its `describe` blocks into files of at most 300 lines, named after the
    area they cover, as `.claude/skills/module-structure` describes. Move shared builders and fakes
    to `tests/utils/`. Update every importer; Biome forbids barrel files.
  - Group by the feature seams of the writer (scopes and validation, channels, `ask`, streams,
    ports, utility and brokered channels, service workers).
  - Mirror the layout of the matching source modules if their split has landed.
- **Tests:** The number of tests (and of `it.fails` and `it.skip`) is the same before and after,
  with no assertion changed; the whole suite passes; `bun scripts/check-size.ts --update` lowers the
  baseline in the same commit.
- **Delivered:** 2026-10-09. `main-bindings.test.ts` is now 15 files, `main-bindings.<area>.test.ts`
  (unicast, broadcast, emit, structure, arguments, senders, errors-and-prefix, ports, main-ports, asks,
  streams, utility, broker, scopes, watches), the largest 264 lines. The 124 tests keep their full names
  (every file keeps the `MainBindingsWriter` describe and its own `mockGetTargetFilePath`), and no line of
  an assertion changed. No `it.fails` or `it.skip` existed. No helper moved to `tests/utils/`: each
  `describe` builds its `render` locally and no two files share one. The baseline entry is removed.
