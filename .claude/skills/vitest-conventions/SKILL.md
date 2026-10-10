---
name: vitest-conventions
description: >-
  Conventions for tests in this repo: proving that a test can fail, doubles and fakes that
  cannot fail, timing without fixed sleeps, order independence under Node and Bun, temp
  directory cleanup, zero warnings, the 90% per-file coverage gate, and how to run one test fast.
  Read when writing or fixing tests, when a test is flaky or passes under one runtime only,
  when a coverage threshold fails, and before writing a regression test.
---

# Vitest conventions

`CLAUDE.md` says what is required (a test for every behavior change, a regression test that fails
without the fix, assertions on generated text, `it.fails` for bugs found by a real-Electron
scenario). This skill is how to do that well.

## Prove the test can fail

A test that passes both with and without the code it covers is documentation, not a test.

1. Write the test, and see it pass.
2. **Break the production line it covers**: flip a comparison, delete a guard, change a literal in
   the generator. A regression test must fail without the fix, so for a bug fix, revert the fix.
3. See the test go red **for the reason you expect**; read the failure.
4. Put the line back.

The size gate tests (`tests/size-gate.test.ts`) were checked this way, and five of five mutations
were caught. A review found tests in this suite which could not fail (a "ignores a credit" test that sent
the credits while the stream was paused, a `toBeDefined()` on a fake's `close`).

## Doubles that quietly answer for the code under test

The suite uses `vi.fn`, `vi.mock` and fake timers about 500 times. Three shapes give a green test
that cannot fail:

| Shape | What it hides | Instead |
|:--|:--|:--|
| A `vi.fn()` or auto-mock in place of a guard the real code calls (a validator, a sender check, a `throw` path) | Deleting the guard keeps the suite green | Give the double a rejecting or throwing case in at least one test, and assert the failure propagates |
| Fake timers (`vi.useFakeTimers`) in a test which stages order by delays | The delays collapse, and events finish in the order they started | Stage order with explicit promises or gates that the test releases in the order it wants |
| An assertion on something already true before the code ran (`toBeDefined()`, a default, a declared member) | Passes if the code under test never ran | Assert the value the run produced |

**A fake must behave like the thing it replaces.** A review found a `contextBridge` fake that handed the
page the very object it got and allowed one key twice, which hid real behavior; the real one copies
and throws. When a fake grows, check it against the Electron docs, not against the test you are
writing.

Mock only the boundary: Electron, the file system, the clock, the network. Never mock the parser,
the validators or the writers; the whole value of the suite is that they run for real.

## Time and ordering

- **No fixed sleeps to wait for delivery.** A 20 ms settle was a flaky wait for `MessagePort`
  messages in nine e2e files. Use `settlePorts` from `tests/utils/e2e/runtime-utils.ts`, or
  wait on the event itself.
- A test that needs a long type-check says so with its own timeout, as the e2e tests that run tsc
  more than once do. Do not raise the global timeout.

## Order independence and runtimes

CI runs the suite on Node 22, Node 24 and Bun, and the e2e and Electron suites separately.

- A test must pass alone, in any order, and from any working directory. A review found tests which only
  passed from the repo root because an earlier test left a spy behind.
- Whatever a test replaces, it restores: `vi.restoreAllMocks`, `vi.useRealTimers`, `process.env`,
  `process.cwd`. Prefer the restoring hook (`afterEach`) to restoring inline, which a failing
  assertion skips.
- Do not mock a property that one runtime reads natively and the other does not (`process.cwd` is
  read by Node's `path.resolve`, not by Bun's). Pass the value in instead.
- To reproduce a Bun-only failure: `bun --bun vitest run <file>`. A plain `bunx vitest` hands over
  to Node.

## Temp directories and files

The e2e fixtures copy schemas into temp directories. Create them so that cleanup runs on failure too
(`afterEach` or `finally`; see `cleanup` in `tests/utils/e2e-utils.ts`). Leaks left by
failing tests were fixed once; a new fixture helper must not bring them back.

## Zero warnings

A passing test that prints a warning (an unhandled rejection, a Node deprecation, a vitest notice)
is not done. Fix the cause. Suppress only for third-party code that cannot be fixed, as narrowly as
possible.

## Coverage

`vitest.config.ts` requires **90% per file** (statements, branches, functions, lines) for `src/**`.
The gate applies to a whole-suite run. A single-file run against it fails on every file you did not
run, which is noise.

- To judge a change, run the whole suite: `bunx vitest run`.
- To work on one test, turn coverage off:

```bash
bunx vitest run tests/test_validators/config.options.test.ts -t "ipcDataDir path is absolute" --coverage.enabled=false
```

- A failing async or Electron test: run that one test alone first. A problem which shows up only in
  the whole suite is almost always shared state or order, not logic.
- The e2e and Electron suites also run with coverage off, as in CI:
  `npx vitest run tests/test_e2e --coverage.enabled=false`, `bun run test:electron`.

## Shape of a test file

- One file per area, at most 300 lines (see [`module-structure`](../module-structure/SKILL.md)).
  When a `describe` block pushes it over, that block is a new file.
- Shared builders and fakes go to `tests/utils/`, imported with the `@testutils/` alias, not copied.
- A regression test says what broke, as in `tests/test_validators/config.options.test.ts`
  (`// Regression: 2.5 was accepted and silently rounded down by repeat.`).
- Tests that cover generated code assert on the generated text, and e2e tests type-check it.
- New test files carry the Apache-2.0 header.

## Related

- File size and splits: [`module-structure`](../module-structure/SKILL.md)
- Session protocol, Electron scenario rules and the `it.fails` rule: `CLAUDE.md`
