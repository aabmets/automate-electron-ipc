# T38a: Config file, precedence, `--cwd` and `--config`

Phase 4: Developer experience. Split from [T38](./T38-config-file-and-cli-flags.md).
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** config can only live in `package.json#config.autoipc`, the CLI has no flags, and an
  unknown config key fails with superstruct's raw text ("At path: listner -- Expected a value of
  type `never`").
- **Decisions (made by the user's architect review; follow them):**
  - Config file names: `autoipc.config.json`, `autoipc.config.mjs`, `autoipc.config.ts`, searched
    only in the project root (the directory of the nearest `package.json`, see
    `utils.resolveUserProjectPath`). `--config <path>` names a file instead (relative to the cwd).
  - More than one `autoipc.config.*` in the root is an error naming both files.
  - A config file **and** a non-empty `package.json#config.autoipc` is an error ("config is set in
    both '<file>' and 'package.json#config.autoipc'; keep one"). There is no merging of the two.
  - Precedence: CLI flags > the one config source > defaults.
  - `.mjs` and `.ts`: the default export is the config object, or a function (sync or async) that
    returns it. `.ts` is transpiled with `@swc/core` `transformSync` (already a dependency; do not
    add a dependency) to a temp `.autoipc.config.<random>.mjs` next to the config file, imported
    with a `file://` URL, and deleted in a `finally`. Relative imports of `.ts` files from a `.ts`
    config are not supported; say so in the README.
  - Paths in any config source are relative to the project root (existing convention).
  - Add `defineConfig(config: IPCOptionalConfig): IPCOptionalConfig`, a typed identity function,
    to `src/index.ts`. `IPCOptionalConfig` is internal today (`types/internal-config.d.ts:14`):
    move its declaration to a new public `types/config-file.d.ts` as `AutoIpcConfig`, export that
    file from `types/index.d.ts`, and keep `IPCOptionalConfig` in `internal-config.d.ts` as
    `export type IPCOptionalConfig = AutoIpcConfig` so internal code is unchanged. Declare
    `defineConfig(config: AutoIpcConfig): AutoIpcConfig` next to it.
- **Interface (T38b, T38c, T39, T40 and T41a build on this; keep it exact):**
  - Extend `RunOptions` in `types/internal-run.d.ts` (from T139):
    ```ts
    export interface RunOptions { cwd?: string; configFile?: string; overrides?: IPCOptionalConfig }
    ```
  - `getResolvedConfig(options?: t.RunOptions | string)` in `src/config.ts`: a string is the `cwd`.
    Keep it on the default-export object `cfg`, because `tests/utils/automation-utils.ts` spies on
    `cfg.getResolvedConfig`. Put config file discovery and loading in a new `src/config-file.ts`
    (`config.ts` must not grow past 280 lines).
  - `planRun`/`ipcAutomation` pass the options through.
  - In `src/cli.ts`, register `--cwd <dir>` and `--config <file>` with commander, and pass them as
    `{ cwd, configFile }`. Keep each option registration on its own lines, so T38b, T39 and T40 can
    append theirs without conflicts.
- **Unknown keys:** superstruct `object()` already rejects them (`src/validation/config-validation.ts:29`).
  Turn that error into `Unknown config key 'listner' in <source>. Known keys: <sorted list>.`, and
  name the source (config file path, or `package.json#config.autoipc`) in every config validation
  error. Do this here, not in T42.
- **Tests:**
  - `tests/test_config/configFile.test.ts`: each of the three formats; a function default export;
    two config files → error; config file plus `package.json#config.autoipc` → error; `--config`
    path; the `.ts` temp file is deleted after success and after a throwing config.
  - `tests/test_config/precedence.test.ts`: overrides beat the file; the file beats defaults.
  - `tests/test_config/unknownKey.test.ts`: the message for an unknown key, for each source.
  - `tests/cli.test.ts`: `--cwd` and `--config` reach `ipcAutomation`.
  - `runFixture` reads `manifest.config.autoipc.ipcDataDir` (`tests/utils/e2e-utils.ts`). Add a
    `runFixture` option for fixtures whose config lives in a config file, and one e2e fixture using
    `autoipc.config.ts`.
- **README:** add the config file and the two flags to "Optional Configuration".
- **Follow-up IDs:** T142-T143.
- **Delivered:** 2026-10-09. Config file discovery and loading are in `src/config-file.ts`; `RunOptions` (`cwd`, `configFile`, `overrides`) is in `types/internal-run.d.ts`, created here because T139 had not landed (T139 adds `OutputFile` and `RunPlan` to it). Unknown keys and invalid values name the source (`validateOptionalConfig(config, source, overrideKeys)`); a key set through `overrides` names "the run options". `runFixture` takes `ipcDataDir` for fixtures that configure through a file (fixture `config-file-ts`).
