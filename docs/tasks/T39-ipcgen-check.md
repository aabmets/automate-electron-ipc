# T39: `ipcgen --check`

Phase 4: Developer experience.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** CI cannot detect stale generated files.
- **Decisions (from the architect review):**
  - No schema hash in the notice header. Comparing the rendered text with the files on disk
    already detects staleness, and a hash would change every generated file on any schema edit.
    (Dropped from the original scope.)
  - When the schema path does not exist, `--check` prints the existing "schema not found" message
    and exits 1, and creates no directory.
- **Scope:**
  - `ipcgen --check` in `src/cli.ts` (append the option; T38a established the pattern).
  - New `src/check.ts`:
    `export async function findStaleOutputs(options?: t.RunOptions): Promise<string[] | null>`.
    It calls `planRun()` (T139) and compares each `OutputFile.contents` with the bytes on disk; a
    missing file is stale. Returns absolute posix paths, sorted; `null` when the schema is missing.
    It writes nothing. T41a's `check()` and T43a's stale-file report build on this function.
  - New `logger.staleFiles(paths: string[], projectRoot: string)`: one path per line, relative to
    the project root, after a header line like `Generated files are out of date:`. And a success
    line `Generated files are up to date.` when nothing is stale.
  - CLI: stale or missing schema → `process.exitCode = 1`. Errors → `logger.fatalError` and exit 1,
    as in a normal run.
- **Tests:**
  - New `tests/test_e2e/automation/check.test.ts` (use the fixture tracker `fixtures.run`; read
    `.claude/skills/vitest-conventions`): fresh output → `[]`; an edited schema → lists `main.ts`
    and the other changed files; a deleted output → listed; a hand-edited output → listed; check
    mode writes nothing (snapshot the directory listing and contents before and after, no
    mtimes); missing schema → `null` and no directory created.
  - `tests/cli.test.ts`: `--check` sets `process.exitCode = 1` for stale and `0`/unset for fresh,
    and does not call `ipcAutomation`.
  - `tests/logger.test.ts`: the two new messages.
  - If T38c has landed: run the check before any `typecheckProject` call in a fixture, since the
    type check writes a `tsconfig.json` that flips NodeNext detection.
- **README:** document `--check` and a CI example (`npx ipcgen --check`).
- **Follow-up IDs:** T148-T149.
- **Delivered:**
