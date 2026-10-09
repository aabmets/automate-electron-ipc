# T129: One schema source loop in `ipcAutomation`

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `ipcAutomation` (`src/automation.ts`) has two near-identical branches for a
  schema file and a schema directory: each reads the contents, calls `parseSpecs` and keeps the
  files with channels.
- **Scope:** Extract `loadSchemaSources(config)` (returns the `RawFileContents` in their order)
  into its own module, and parse them in one loop. The order of the files, the warnings and the
  errors stay the same.
- **Tests:** The `tests/test_automation` and e2e tests pass unchanged; generated output
  byte-identical.
- **Delivered:** 2026-10-09. `loadSchemaSources(config)` is in the new `src/schema-sources.ts`; `ipcAutomation` parses its result in one loop. Order, warnings and errors are unchanged. 3288 tests (5 new, for the loader).
