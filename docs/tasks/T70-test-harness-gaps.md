# T70: Test harness and fixture gaps

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the review of Phases 0 and 1. The tests are mostly strong, but these let
  regressions through:
  - `tests/utils/tsc-utils.ts` `runTsc` ignores the exit status. If tsc is killed or crashes
    without output, the result is `""` and every `expect(await typecheck()).toBe("")` passes.
  - The e2e type-check always uses `moduleResolution: "bundler"`, so the `.js`/`.mjs`/`.cjs`
    extensions chosen for `projectUsesNodeNext` are only asserted as text. (Checked by hand in
    the review: the output does resolve under NodeNext.)
  - `tests/utils/writer-utils.ts` and `validator-utils.ts` build specs with
    `async: returnType.includes("Promise")` (the substring check T56 removed), a rest parameter
    typed `number` (`...arg2: number`, which is not valid TypeScript) and `listeners`, which the
    parser never sets. The writer tests assert text built from these specs.
  - `tests/config.test.ts` mocks `fsp.stat` to give the schema dir and the schema file the same
    answer, so the choice in `getResolvedConfig` (dir only, file only, both) is untested, and it
    asserts `toMatchObject({})`, which matches any object.
  - Nothing compares the keys that `preload.ts` exposes with `Window.ipc` in `window.d.ts`, the
    unicast `handle` wrapper is never run, and `preload.ts` is never run against a fake
    `contextBridge`.
  - Weak assertions: `toContain("User")`, `not.toContain("any")` (substring), `not.toThrow()` only,
    bare `toThrowError()`, and a copy-pasted `describe("PreloadBindingsWriter")` name in
    `renderer-types.test.ts`.
  - `vitest.config.ts` has an MIT license header; the repo is Apache-2.0.
- **Scope:** throw in `runTsc` when tsc exits abnormally, add a NodeNext option to the e2e
  type-check and use it for `dotted-imports`, build writer test specs through the parser or fix
  them, mock `stat` per path, and add the missing runtime and key-set tests. Fix the assertions
  and the header listed above.
- **Tests:** the changed tests themselves; a harness test that a crashing tsc is reported.
