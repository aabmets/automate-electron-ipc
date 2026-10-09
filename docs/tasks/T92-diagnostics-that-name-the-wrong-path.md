# T92: Diagnostics which name the wrong path, or none

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the review of 2026-10-09.
  - With a single `schema.ts`, the `relativePath` of the file is the data dir, so the clone
    warnings and the errors of the global validation say `Schema file 'ipc'` and not
    `Schema file 'ipc/schema.ts'`.
  - A `package.json` that is not valid JSON fails with the bare message of `JSON.parse`, which names
    no file.
- **Scope:** give the single schema file its own relative path; name the file in the error of a
  manifest that cannot be parsed. The wider work on diagnostics stays in T42.
- **Tests:** the `it.fails` of `T92` in `tests/test_e2e/generatorFindings.test.ts` turn into
  passing tests.
- **Delivered:** 2026-10-09. The two `it.fails` moved to `tests/test_e2e/ipcAutomation.test.ts` as passing
  tests, with unit tests in `tests/config.test.ts`. A single schema file is `<ipcDataDir>/schema.ts`
  in the messages. The manifest error reads `Cannot parse '<path>': it is not valid JSON. <reason>`.
  The `ipcDataDir: "ipc/schema.ts"` mock of `tests/automation.test.ts` encoded the old behavior and is
  now `"ipc"`. `src/cli.ts` still reads the version with a bare `JSON.parse`, but of this library's own
  manifest, so it is left alone.
