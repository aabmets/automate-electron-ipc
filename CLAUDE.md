# automate-electron-ipc

Code generator (`ipcgen` CLI) that turns declarative channel expressions in a user's
`<ipcDataDir>/schema.ts` (or `schema/**`) into typed Electron IPC bindings:
`main.ts`, `preload.ts` and `window.d.ts`.

- `src/parser.ts` parses schema files with swc and collects channel, type and import specs.
- `src/validators.ts` validates those specs (superstruct).
- `src/writer/*` emits the three generated files.
- `src/automation.ts` orchestrates a run; `src/cli.ts` is the bin entry.
- Public types live in `types/index.d.ts`; internal types in `types/internal.d.ts` (alias `@types`).

## Commands

- Type check and lint: `bun run check`
- Tests: `bunx vitest run` (tests live in `tests/**`, named `*.test.ts`; helpers in `tests/utils/`)
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
3. Implement **only that task**. Do not start, or partially start, any other task.
   - Every behavior change needs unit tests. Every bug fix also needs a regression test that fails
     without the fix.
   - Tests that cover generated code must assert on the generated text. Once T01 exists, they must
     also type-check the output via the e2e harness.
   - Keep the generated runtime code sandbox-safe (it runs in a sandboxed preload or the main process)
     and free of any dependency on this library at runtime.
4. Before committing, all of these must pass: `bun run check` and `bunx vitest run`.
   Once T11 lands, the Node e2e job must pass too.
5. In the same commit:
   - flip the task to `[x]` in the roadmap and update its **Progress** line;
   - fill in `Delivered:` in the task file with the date and a one-line note on anything notable
     (deviations, follow-ups);
   - if new follow-up work was discovered, add it as a new task with the next free ID: a new task
     file, plus a roadmap entry at the end of the matching phase.
6. Make exactly **one commit** for the task, with message `T<NN>: <short summary>` followed by a body.
   Push it to the session's designated branch.
7. **Stop.** Report what was delivered and which task is next. Do not continue to the next task.
   The user clears the session between tasks.

If a task turns out too large for one reviewable commit, split it into `T<NN>a`, `T<NN>b`, and so
on, each with its own task file and roadmap entry. Deliver only the first part, and say so.

@docs/roadmap.md
