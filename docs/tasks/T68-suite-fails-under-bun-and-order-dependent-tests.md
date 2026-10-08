# T68: The suite fails under Bun; order-dependent and under-restored tests

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the review of Phases 0 and 1.
  - `bun --bun vitest run`, the Bun leg of the CI matrix (T11), fails 1 of 462 tests with Bun 1.4.2:
    `tests/utils.test.ts` "resolves a relative cwd against the working directory". It mocks
    `process.cwd`, which Node's `path.resolve` calls but Bun's native one does not.
  - `searchUpwards` tests in `tests/utils.test.ts` spy on `fs.existsSync` without restoring after
    each test. The first one expects `process.cwd()/testfile.txt` although the default start is
    the `src/` directory (`import.meta.url`), so it passes only when the cwd is the repo root.
  - `tests/cli.test.ts` imports `@src/cli.js` for `--version` without `vi.resetModules()` and
    relies on running first.
  - `tests/test_e2e/ipcAutomation.test.ts` (T02) matches `'(a|b)\.ts' and '(a|b)\.ts'`, which also
    matches the same file named twice.
- **Scope:** make these tests runtime-independent (use a relative path computed from the real cwd
  instead of mocking `process.cwd` in that case), restore mocks after each test, compute expected
  paths from the file under test, reset modules in the CLI tests and tighten the regex.
- **Tests:** the suite passes under Node 22 and under `bun --bun vitest run`, also with
  `--sequence.shuffle` and from another working directory.
