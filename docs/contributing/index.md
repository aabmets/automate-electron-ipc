# Contributing

This page describes how to set up the repository, build and test the library, and what a change needs before it can be merged. It also covers how to build this documentation.

## Set up

You need Node 22.13 or later (the generator runs on it) and [Bun](https://bun.sh), which is the package manager and dev runtime of the repo.

```bash
bun install
bunx lefthook install         # once: the pre-commit hook, see below
```

## Commands

```bash
bun run check                 # tsc, biome and the file size gate
bunx vitest run               # the whole suite, with coverage
bun run test:electron         # only the tests that run in a real Electron
```

`bunx vitest run` hands over to Node. To reproduce a failure that happens only under Bun, run `bun --bun vitest run <file>`. To run a single test file fast, turn the coverage gate off, since it applies to the whole suite:

```bash
bunx vitest run tests/test_validators/config.options.test.ts --coverage.enabled=false
```

CI runs `bun run check`, the suite on Node 22, Node 24 and Bun, the e2e tests on Node 22 and 24, and the real-Electron tests. A change should pass all of them.

## The layout

| Directory | Holds |
|-----------|-------|
| `src/parser/` | Reads the schema files with swc: the `defineChannels` map, the signatures and the type declarations |
| `src/validation/` | The superstruct validators of the config, the channel specs and the type specs |
| `src/writer/` | Writes the generated files, one directory per output: `main/`, `preload/`, `renderer/`, `utility/` |
| `src/` root | `automation.ts` (a run), `cli.ts` (the `ipcgen` entry) and helpers that every layer uses |
| `types/` | The public types of the package (`index.d.ts`) and the internal ones (`internal.d.ts`). Both are thin entries that re-export themed files: add new declarations to the matching file, not to the entry |
| `tests/` | Mirrors `src/`. `tests/test_e2e/` and `tests/test_electron/` group by feature area, `tests/fixtures/` holds the schema projects that the e2e tests generate and type-check, and `tests/utils/` holds shared helpers |
| `docs/` | This documentation |

## Code style

- Three-space indents, double quotes, and the Apache-2.0 header on every new source file. Biome formats and lints; `bun run check` fails on what it reports.
- The pre-commit hook (lefthook) runs `biome check --write` on the staged files and stages the fixes.
- A source, test or type file may have at most 300 lines, not counting the license header; 280 lines draw a warning from `bun run check`. There are no exceptions: put new code in a new module that the old file calls, split along the feature seam, and update every importer. Barrel files and re-export-all are errors in Biome, so do not leave one behind. `tests/fixtures/` is exempt.
- The generated runtime code runs in a sandboxed preload script or in the main process. Keep it free of any dependency on this library.

## Tests

- Every behavior change needs unit tests, and every bug fix needs a regression test that fails without the fix.
- A test of generated code asserts on the generated text. The e2e tests also type-check the output together with the schema files.
- Mock only the boundary: Electron, the file system, the clock. The parser, the validators and the writers run for real.
- A test must pass alone, in any order and from any working directory, restore what it replaces, and wait on events instead of fixed sleeps.
- Coverage must stay at 90% per file for `src/**`.
- A passing test run prints no warnings.

### Real-Electron tests

Most tests load the generated files against a fake `electron` module. The tests in `tests/test_electron/` run them in the `electron` binary the repo depends on, in hidden windows with `sandbox: true` and `contextIsolation: true`, so that `contextBridge`, `senderFrame`, `MessagePort` transfer and the sandboxed preload script are the real ones. They need:

- **The Electron binary.** `bun install` does not run the postinstall script of `electron`, so run `node node_modules/electron/install.js` once.
- **A display.** On Linux without `$DISPLAY` the tests start Electron under `xvfb-run -a`, so install `xvfb` (`apt-get install xvfb`). macOS and Windows need nothing.
- **`ELECTRON_NO_SANDBOX=1`** where Chromium's sandbox helper cannot run, such as in a container as root (the tests add the flag by themselves for root) or on a CI image whose kernel forbids it. It turns off the helper only; the windows still use `sandbox: true`.

Without the binary or a display these tests are skipped, and `bunx vitest run` stays green. With `REQUIRE_ELECTRON=1`, which CI sets, they fail instead, so a broken setup cannot pass unnoticed.

The scenarios are functions that are turned into text and run inside Electron, so they can use only their `ctx` argument (`ctx.data` for constants). A scenario that finds a bug in the generated code is added as `it.fails`, with a comment that says what is wrong, and the bug is fixed in a change of its own.

## Documentation

The pages in `docs/` are built with MkDocs Material. Build the site with the same command as the Pages workflow, which fails on a broken link or anchor:

```bash
uv run --with "mkdocs-material>=9.7.7" mkdocs build --strict
```

Replace `build --strict` with `serve` to preview the pages while you edit them.

Code blocks that follow a `readme-example` tag comment, which names an example and a file path, are run by `tests/test_e2e/automation/readmeExamples.test.ts`. The blocks with the same `NAME` are the files of one project: the test generates its bindings and type-checks the schema and the code together with the generated files. When you change such a block, run that test:

```bash
bunx vitest run tests/test_e2e/automation/readmeExamples.test.ts --coverage.enabled=false
```
