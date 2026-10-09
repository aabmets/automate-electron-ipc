# T38b: Output path options and `--out-*` flags

Phase 4: Developer experience. Split from [T38](./T38-config-file-and-cli-flags.md).
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `main.ts`, `preload.ts` and `window.d.ts` are always written to `ipcDataDir`.
  (`utilityBindingsPath` and `serviceWorkerPreloadPath` can already be set, see
  `src/config-outputs.ts:88-114`.)
- **Scope:**
  - New optional keys `mainBindingsPath`, `preloadBindingsPath`, `rendererTypesPath`, relative to
    the project root. Validate them like `utilityBindingsPath` in
    `src/validation/config-validation.ts`; `rendererTypesPath` must end in `.d.ts` (it needs its
    own refine, because `relativeScriptPath` rejects `.d.ts` via `isSchemaSourceFile`). The others
    must end in `.ts`.
  - Derive the paths in `deriveOutputPaths` (`src/config-outputs.ts`). Scoped files keep deriving
    from the base path via `scopedFilePath`.
  - Extend `assertOutputsDistinct` (`src/config-outputs.ts:133`) and `assertScopeFilesFree`
    (`src/automation.ts`) to the three new keys.
  - CLI flags `--out-main <file>`, `--out-preload <file>`, `--out-types <file>` in `src/cli.ts`.
    They map to `overrides` (the T38a `RunOptions`). Flag paths are relative to the **cwd**; convert
    them to project-root-relative before they become overrides.
  - Generated imports between the files (e.g. the main bindings importing the schema) must stay
    correct when the files live in different directories. Check `src/writer/import-paths.ts` and
    the imports generator; add a test that moves each file to another directory and type-checks.
- **Tests:** `tests/test_config/outputPaths.test.ts` cases for each key (valid, wrong extension,
  clash with another output); `tests/cli.test.ts` for each flag; one e2e fixture with all three
  files in different directories that passes `typecheckProject`.
- **README:** add the keys and flags to "Optional Configuration".
- **Follow-up IDs:** T144-T145.
- **Delivered:**
