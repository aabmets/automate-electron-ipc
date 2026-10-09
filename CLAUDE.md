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
  soft limit, and draws a warning). Files that were already over are in `size-baseline.json` and may
  only shrink: never add or raise an entry. Put new code in a new module, not in a big file. Read
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
  code is not fixed in the same task: add it as `it.fails`, with the new task's ID in a comment.
- Read `.claude/skills/vitest-conventions` before writing or fixing tests.
- Biome formats on pre-commit (lefthook). Use 3-space indents, double quotes, and the Apache-2.0 header on new source files.

## Work tracker: one task per session

The roadmap lives in [`docs/roadmap.md`](./docs/roadmap.md), imported below. It is the overview of
every task: what is done, what remains, and each task's dependencies. Each task's goal, scope, tests
and delivery note are in its own file, `docs/tasks/T<NN>-<slug>.md`. Do not read all task files to
get an overview; the roadmap is enough. Every session follows this protocol:

1. Read the roadmap. Pick the **first** task marked `[ ]` whose `depends on` tasks are all `[x]`
   (or `[-]` dropped).
   If the user names a specific task, do that one instead.
   Then read that task's file. Read other task files only when the task refers to them.
2. If the task is marked **Decision needed**, ask the user that question before writing code.
3. **Plan before editing.** Read the code the task touches, then write a short plan in your reply:
   files to change, approach, test cases, and anything in the task file that no longer matches the
   code. Then continue without waiting for approval, unless the plan has to go beyond or against
   the task's scope; in that case, stop and ask the user.
4. Implement **only that task**. Do not start, or partially start, any other task.
   - Every behavior change needs unit tests. Every bug fix also needs a regression test that fails
     without the fix.
   - Tests that cover generated code must assert on the generated text. Once T01 exists, they must
     also type-check the output via the e2e harness.
   - Keep the generated runtime code sandbox-safe (it runs in a sandboxed preload or the main process)
     and free of any dependency on this library at runtime.
5. Before committing, all of these must pass: `bun run check` and `bunx vitest run`.
   Once T11 lands, the Node e2e job must pass too. Check that `git diff --cached` includes
   `docs/roadmap.md`; a task commit without a roadmap change is incomplete.
6. **Update `docs/roadmap.md`** in the same commit. A task is not done until the roadmap says so:
   - flip the task's marker from `[ ]` to `[x]`;
   - update the **Progress** line counts to match the markers;
   - if the task was dropped instead, mark it `[-]` and say why in its task file;
   - if a **Decision needed** question was answered, remove the flag from the roadmap entry.

   Also in the same commit:
   - fill in `Delivered:` in the task file with the date and a one-line note on anything notable
     (deviations, follow-ups);
   - if new follow-up work was discovered, add it as a new task with the next free ID: a new task
     file, plus a roadmap entry at the end of the matching phase, with its `depends on` list.
7. Make exactly **one commit** for the task, with message `T<NN>: <short summary>` followed by a body.
   Push it to the session's designated branch.
8. **Stop.** Report what was delivered and which task is next, as read from the updated roadmap.
   Do not continue to the next task. The user clears the session between tasks.

If a task turns out too large for one reviewable commit, split it into `T<NN>a`, `T<NN>b`, and so
on, each with its own task file and roadmap entry. Deliver only the first part, mark only that
part `[x]` in the roadmap, and say so.

@docs/roadmap.md
