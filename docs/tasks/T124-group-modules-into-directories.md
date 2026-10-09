# T124: Group the source and test modules into directories

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** After the splits of T103 to T123, `src/` held 33 modules side by side and
  `src/writer/` 47; `tests/test_e2e/` held 130 files and `tests/utils/` 45. The dependencies
  between the modules (parser, validation, one writer per generated file) were not visible in the
  tree.
- **Scope:**
  - Group `src/` by dependency, at most two directory levels deep: `parser/` (with `channel/` and
    `type/`), `validation/`, and `writer/main/`, `writer/preload/`, `writer/renderer/`,
    `writer/utility/`. Entries, `automation` and the helpers that every layer uses stay at the root.
  - Mirror that layout in `tests/test_parser/` and `tests/test_writer/`; group `tests/test_e2e/` and
    `tests/test_electron/` by feature area; group `tests/utils/` by the tests that use each helper.
  - Files only move: no file is renamed, and no code changes beyond import specifiers, the import
    order Biome sorts, and the paths in `biome.json` overrides and in tests that locate the repo root.
  - Update `CLAUDE.md` and the `module-structure` skill, which advised against new directories.
- **Tests:** The generated output of every fixture is byte-identical before and after (`diff -r`);
  the number of test files and tests is the same; `bun run check` and `bunx vitest run` pass.
- **Delivered:** 2026-10-09. 294 files moved with `git mv`, imports rewritten by resolving each old
  target to its new path. The output of all 96 fixture projects is byte-identical, and the suite has
  246 files and 3276 tests before and after. The `module-structure` skill has a new section, "Where
  files go". The further refactorings found while surveying the source and the tests are T125 onward.
