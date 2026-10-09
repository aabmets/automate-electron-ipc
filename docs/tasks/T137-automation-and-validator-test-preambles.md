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
- **Delivered:**
