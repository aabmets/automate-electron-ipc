# T43b: `format` option

Phase 4: Developer experience. Split from [T43](./T43-generated-file-hygiene.md).
Status and dependencies are in the [roadmap](../roadmap.md).

- **Decisions (from the architect review):**
  - The formatter runs from the user project's `node_modules/.bin` with `spawnSync` and stdin,
    never through an import: `biome format --stdin-file-path=<path>` or
    `prettier --stdin-filepath <path>`, with the project root as cwd so the user's formatter config
    applies.
  - When the binary is missing: print a warning once per run and write the unformatted output.
    A formatter that exits non-zero is an error naming the file and the formatter's stderr.
- **Scope:**
  - Config key `format: "biome" | "prettier" | false`, default `false`, in the config validator,
    the defaults, `AutoIpcConfig` (T38a) and the README.
  - Format inside `planRun` (T139) after rendering, so `--check` (T39) and the API compare
    formatted text. The header from T43a stays the first lines.
  - Put the formatter call in a new `src/formatter.ts`, with the spawn function injectable for
    tests.
- **Tests:** unit tests with an injected spawn (each formatter's arguments; missing binary →
  warning, unformatted; non-zero exit → error); one e2e that formats with the repo's own Biome
  (`node_modules/.bin/biome` exists here) and checks that `--check` reports a fresh project as up to
  date after a formatted run.
- **Follow-up IDs:** T162-T163.
- **Delivered:** 2026-10-09. `format` runs inside `planRun` through `src/formatter.ts` (injectable spawn). The
  formatter gets the body without the notice, and the notice is put in front of its output: the notice
  has `biome-ignore-all format`, which makes Biome return the whole file unformatted. A formatter that
  cannot be spawned for a reason other than a missing binary (such as `EACCES`) is an error too. No
  follow-ups; T162-T163 stay unused.
