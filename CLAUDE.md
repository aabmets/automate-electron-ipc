# automate-electron-ipc

Code generator (`ipcgen` CLI) that turns declarative channel expressions in a user's
`<ipcDataDir>/schema.ts` (or `schema/**`) into typed Electron IPC bindings:
`main.ts`, `preload.ts` and `window.d.ts`.

- `src/parser/` parses schema files with swc and collects channel, type and import specs
  (`parser.ts`); `channel/` reads the `defineChannels` map, `type/` reads signatures and type
  declarations.
- `src/validation/` (superstruct): `config-validation.ts` (config), `channel-validation.ts` with
  `channel-spec-structs.ts`, `option-structs.ts` and `clone-issues.ts` (one file's channel specs),
  `global-validation.ts` (across files, and type specs).
- `src/writer/` emits the generated files: one directory per output (`main/`, `preload/`,
  `renderer/`, `utility/`), with the shared writer base and import handling at its root.
- `src/automation.ts` orchestrates a run; `src/cli.ts` is the bin entry. Shared helpers (`config`,
  `logger`, `scopes`, `utils`, `cache`) sit at the root of `src/`.
- Tests mirror that layout (`tests/test_parser/channel/`, `tests/test_writer/main/`, ...);
  `tests/test_e2e/` and `tests/test_electron/` group by feature area, and `tests/utils/` groups the
  helpers by their users (`electron/`, `e2e/`, `parser/`, `writer/`).
- Public types live in `types/index.d.ts`; internal types in `types/internal.d.ts` (alias `@types`).
  Both are thin entries that `export *` from the other files in `types/`; Biome allows that in these
  two files only. Add new declarations to the matching themed file, not to the entry.

## Commands

- Type check, lint and file size gate: `bun run check`. The gate (`scripts/check-size.ts`) allows at
  most 300 lines per file in `src/`, `tests/` and `types/` (license header not counted; 280 is the
  soft limit, and draws a warning). There are no exceptions: put new code in a new module, not in a
  big file. Read
  `.claude/skills/module-structure` before adding, splitting or growing files.
- Tests: `bunx vitest run` (tests live in `tests/**`, named `*.test.ts`; helpers in `tests/utils/`)
- Real-Electron tests: `bun run test:electron` (`tests/test_electron/`). They run the generated bindings
  in the `electron` binary, with hidden sandboxed windows, and need the binary (`node
  node_modules/electron/install.js`, since `bun install` does not run its postinstall) and a display
  (on Linux without `$DISPLAY` they start under `xvfb-run -a`). Without them the tests skip, and with
  `REQUIRE_ELECTRON=1`, as in CI, they fail instead. Root and some CI kernels need
  `ELECTRON_NO_SANDBOX=1` for the sandbox helper of Chromium, which leaves `sandbox: true` of the windows
  alone. The scenarios are functions that are turned into text and run in Electron, so they can use
  only their `ctx` argument (`ctx.data` for constants). A scenario that finds a bug in the generated
  code is not fixed in the same change: add it as `it.fails`, with a comment that says what is wrong.
- Read `.claude/skills/vitest-conventions` before writing or fixing tests.
- Biome formats on pre-commit (lefthook). Use 3-space indents, double quotes, and the Apache-2.0 header on new source files.

## Working conventions

- **Plan before editing.** Read the code the change touches, then write a short plan in your reply:
  files to change, approach and test cases. Continue without waiting for approval, unless the plan
  has to go beyond or against what the user asked; in that case, stop and ask.
- Every behavior change needs unit tests. Every bug fix also needs a regression test that fails
  without the fix.
- Tests that cover generated code must assert on the generated text, and also type-check the output
  via the e2e harness.
- Keep the generated runtime code sandbox-safe (it runs in a sandboxed preload or the main process)
  and free of any dependency on this library at runtime.
- Before committing, `bun run check`, `bunx vitest run` and `bun run test:electron` must pass (with
  `REQUIRE_ELECTRON=1` when the Electron binary and a display are available, else say that the
  Electron tests skipped). The Node e2e job of CI must pass as well.
- Keep the user docs in `docs/` (published with MkDocs Material, see `mkdocs.yml`) in step with
  behavior changes, and check them with `uv run --with "mkdocs-material>=9.7.7" mkdocs build --strict`.
- Do not mix unrelated changes in one commit. If a change turns out too large for one reviewable
  commit, split it into parts and deliver the first one.
- When several sessions work on the same branch, run `git pull --rebase origin <branch>` before
  pushing, and run the checks again after resolving any conflict.
