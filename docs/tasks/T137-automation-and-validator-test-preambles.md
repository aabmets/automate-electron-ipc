# T137: Shared preambles of the automation and config validator tests

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** The five files of `tests/test_automation/` repeat one 12-line block (a temp dir in
  `beforeEach`, `vi.restoreAllMocks` and removal in `afterEach`, a `mockConfig`). The config
  `{ projectUsesNodeNext: false, ipcDataDir: "src/autoipc", codeIndent: 3 }` is written 12 times
  in `tests/test_validators/config.*.test.ts`.
- **Scope:** `useAutomationDir()` in `tests/utils/automation-utils.ts`, which registers its own
  hooks; a `baseConfig` constant in `tests/utils/validator-utils.ts`.
- **Tests:** Same test count, no assertion changed.
- **Delivered:** 2026-10-09. `withAutomationDir(prefix?)` in `tests/utils/automation-utils.ts` registers the hooks (a temp dir per test, mocks restored and the dir removed after it) and returns `dir` and `mockConfig`; the five files of `tests/test_automation/` and `schemaSources.test.ts` (a sixth, with a sync variant of the block) use it. `mockAutomationConfig` is no longer exported. `baseConfig` in `tests/utils/validator-utils.ts` replaces the twelve copies in `config.options.test.ts` and `config.features.test.ts`. Deviation: `withAutomationDir`, not `useAutomationDir`, because Biome's `useHookAtTopLevel` reads `use*` as a React hook. 3319 tests (4 new, for the helper), no assertion changed.
