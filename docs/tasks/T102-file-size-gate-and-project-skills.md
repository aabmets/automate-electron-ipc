# T102: The file size gate and the project skills

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** asked for by the user (2026-10-09), after a review of three Python skills of the Genie
  project. `src/writer/main-bindings.ts` is one class of 3444 lines, `parser.ts` has 1780,
  `preload-bindings.ts` 1486, and 49 test files are over 300 lines. Every feature task made the big
  files bigger, and nothing stopped it.
- **Scope:**
  - A size gate in `bun run check`: soft limit 280 lines (a warning), hard limit 300 (an error),
    license header not counted, for `src/`, `tests/` and `types/` (`tests/fixtures/` is exempt).
  - A ratchet baseline, `size-baseline.json`, for the files that are already over: they may only
    shrink, and nothing may be added to it or raised in it.
  - Two project skills: `module-structure` (the gate, how to split, anti-patterns) and
    `vitest-conventions` (proving a test can fail, doubles that cannot fail, order and runtime
    independence, coverage, running one test fast). Pointers in `CLAUDE.md`.
  - The tasks that work the baseline down to nothing: T103 to T123, in a phase that runs before
    Phase 4.
- **Tests:** `tests/size-gate.test.ts` (26 tests): the line count, every verdict of the gate, the
  ratchet, and the runs on a temp project. Five mutations of the gate (`>=` for `>`, a tolerance of
  one line, a ratchet that raises, a slack soft limit, fixtures counted) each turn a test red.
- **Delivered:** 2026-10-09. The limits (280 and 300) are the user's. The baseline holds 60 files
  (9 in `src/`, 49 in `tests/`, 2 in `types/`). The soft limit only warns, because whether a split
  above 30 lines exists is a judgement; `tests/test_electron/harness.test.ts` (292 lines) is the one
  file there today, left to T119. Biome's `noBarrelFile` and `noReExportAll` also reject re-exports
  in a `.d.ts` file, which is why T112 asks a question. From the Genie skills, the size gate and
  the test discipline carried over. Not taken: no private module-level names, class-module
  encapsulation, a docstring on every test, and `genie buildgraph` (the roadmap here is a plain
  file).
