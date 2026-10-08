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

The roadmap lives in [`TASKS.md`](./TASKS.md), imported below. Every session follows this protocol:

1. Read `TASKS.md`. Pick the **first** task marked `[ ]` whose `Depends on` tasks are all `[x]`.
   If the user names a specific task, do that one instead.
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
5. In the same commit, update `TASKS.md`:
   - flip the task to `[x]`;
   - fill in `Delivered:` with the date and a one-line note on anything notable (deviations,
     follow-ups);
   - if new follow-up work was discovered, append it as a new task at the end of the matching phase,
     with the next free ID.
6. Make exactly **one commit** for the task, with message `T<NN>: <short summary>` followed by a body.
   Push it to the session's designated branch.
7. **Stop.** Report what was delivered and which task is next. Do not continue to the next task.
   The user clears the session between tasks.

If a task turns out too large for one reviewable commit, split it into `T<NN>a`, `T<NN>b`, and so on
in `TASKS.md`. Deliver only the first part, and say so.

@TASKS.md
