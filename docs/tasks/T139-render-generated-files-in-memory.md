# T139: Render the generated files in memory

Phase 4: Developer experience.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `BaseWriter.write()` (`src/writer/base-writer.ts:261-277`) renders and writes in one
  step, and `ipcAutomation` (`src/automation.ts`) calls it for every output. `--check` (T39), the
  API (T41a), stale-file removal (T43a) and the new outputs (T44, T46, T47) all need the rendered
  text without writing it. Without one shared pipeline, each of them would refactor `automation.ts`
  in its own way. This task is a pure refactor: the output must stay byte-identical.
- **Scope:**
  - `base-writer.ts` is at 278 lines (soft limit 280). Add only a small `render(): string` there,
    which returns what `write()` writes today: the empty or full contents, with leading blank lines
    stripped and the notice prepended. Remove `write()` from `BaseWriter`. Move the notice text to
    the new module `src/output-files.ts` as `export const NOTICE`, and have `BaseWriter` read it
    from there (T39 and T43a change the header in that one place).
  - `src/output-files.ts` also gets
    `export async function writeOutputs(outputs: t.OutputFile[]): Promise<void>`, which makes each
    directory (`mkdir -p`) and writes each file.
  - New `types/internal-run.d.ts`, exported from `types/internal.d.ts`:
    ```ts
    /** One generated file: the absolute path in posix form, and the full text with the notice. */
    export interface OutputFile { path: string; contents: string }
    /** Options of a run. T38a adds `configFile` and `overrides`. */
    export interface RunOptions { cwd?: string }
    export interface RunPlan {
       config: IPCResolvedConfig;
       pfsArray: ParsedFileSpecs[];
       outputs: OutputFile[];
    }
    ```
  - Split `ipcAutomation` in `src/automation.ts` into:
    - `export async function planRun(options?: t.RunOptions): Promise<t.RunPlan | null>`: resolves
      the config, parses and validates, and renders every output into `outputs`. It returns `null`
      when the schema path does not exist, and does **not** `mkdir` or log in that case.
    - `export async function ipcAutomation(options?: t.RunOptions | string): Promise<void>`: a
      string is the `cwd` (keeps the existing callers working). It calls `planRun`; for `null` it
      makes the schema directory and calls `logger.nonExistentSchemaPath` as today; otherwise it
      calls `writeOutputs` and logs as today.
    - Build the list of outputs as one array of `[writer]` entries in a helper
      (e.g. `collectWriters(config, pfsArray)`), so that a later output is one new entry. If
      `automation.ts` gets near 280 lines, move the helper to `src/run-plan.ts`.
    - Keep `getResolvedConfig(cwd?: string)` as it is. T38a changes it.
  - Split `tests/utils/e2e-utils.ts` (278 lines): move `typecheckProject` and its file lists
    (`utilityFiles`, `workerFiles`) to `tests/utils/e2e/typecheck-project.ts`. Make the list of
    extra generated files that the type check includes a single exported array, so that T44, T46
    and T47 each add one entry.
- **Tests:**
  - All existing tests pass with only import path changes.
  - New `tests/test_automation/planRun.test.ts`: `planRun` returns the same paths and contents
    that `ipcAutomation` writes for a fixture; it writes nothing (the output directory does not
    exist afterwards); it returns `null` for a missing schema and creates no directory.
  - `tests/test_writer/base-writer.test.ts`: `render()` returns the notice plus the contents.
  - Verify byte-identical output with the fixture diff from the module-structure skill
    (`.claude/skills/module-structure`).
- **Follow-up IDs:** if this task discovers follow-up work, use IDs T140-T141.
- **Delivered:** 2026-10-09. `BaseWriter.write()` is `render()` and `toOutputFile()` now, the notice is `NOTICE` in `src/output-files.ts`, and `ipcAutomation` is `planRun` plus `writeOutputs`, with `collectWriters` in `automation.ts` (280 lines were not near, so no `run-plan.ts`). `render(withNotice = true)` keeps a flag that the writer tests use to assert on the contents without the notice; `renderSpecs` calls it and no longer writes a file. `toOutputFile()` is the one place that makes the posix path. `typecheckProject` is in `tests/utils/e2e/typecheck-project.ts`, and `extraGeneratedFiles` there is the array that T44, T46 and T47 add a finder to. The output of all 95 fixtures is byte-identical before and after (`diff -r`), apart from the temp path in one error message. 3326 tests (7 new) and 214 Electron tests pass.
