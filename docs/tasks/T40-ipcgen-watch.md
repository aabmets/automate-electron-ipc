# T40: `ipcgen --watch`

Phase 4: Developer experience.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Scope correction (architect review):** the output depends only on the schema text, the config,
  `package.json`, `tsconfig.json` (after T38c) and the directory layout. Type files are imported by
  name, not parsed, so "referenced type files" are **not** watched.
- **Scope:**
  - New `src/watch.ts`:
    ```ts
    export function watchedPaths(config: t.IPCResolvedConfig, configFile?: string): string[];
    export function watchSchema(
       options: t.RunOptions,
       deps?: {
          watch?: typeof fs.watch;   // injected in unit tests
          debounceMs?: number;       // default 100
          onRun?: (error: unknown | null) => void;
       },
    ): () => void;                   // closes all watchers
    ```
  - `watchedPaths` returns **directories**, not files (editors that save atomically replace the
    inode): the schema directory (`ipcDataDir`, recursive), the project root (non-recursive, for
    `package.json`, `tsconfig.json` and `autoipc.config.*`), and the directory of `configFile` when
    one is given. T41b reuses this function.
  - Filter events: under `ipcDataDir`, only names that `utils.isSchemaSourceFile` accepts under the
    schema path; in the project root, only `package.json`, `tsconfig.json`, `autoipc.config.*` and
    the given config file. The generated files sit in `ipcDataDir` next to `schema.ts`, so without
    the filter every run would trigger the next one.
  - Debounce events; one run at a time; events during a run cause exactly one more run after it.
  - Each run calls `ipcAutomation(options)`. Errors are printed with `logger.fatalError`, do not set
    `process.exitCode`, and the watcher keeps running. After a config change, recompute
    `watchedPaths` and re-create the watchers if they differ.
  - `ipcgen --watch` in `src/cli.ts` (append the option): first run immediately, then watch.
    SIGINT/SIGTERM close the watchers and exit 0. A new `logger.watching(paths)` line on start.
- **Tests:**
  - `tests/test_watch/watch.test.ts`, unit tests with a fake `watch` (an EventEmitter per path):
    debounce merges a burst into one run; events during a run cause one more run; a failing run
    keeps the watcher alive; generated file names do not trigger a run; a config change re-creates
    the watchers; the closer closes everything. Use fake timers, no sleeps (vitest-conventions
    forbids sleeps). Reach the 90% per-file coverage gate of `vitest.config.ts`.
  - One e2e in `tests/test_e2e/automation/watch.test.ts` with a real temp dir and real `fs.watch`:
    edit the schema → `main.ts` changes; write a syntax error → `onRun` gets the error and a fixed
    schema regenerates again. Wait on `onRun` promises, not on time. It must also pass under
    `bun --bun` (CI matrix).
- **README:** document `--watch`.
- **Follow-up IDs:** T150-T151.
- **Delivered:**
