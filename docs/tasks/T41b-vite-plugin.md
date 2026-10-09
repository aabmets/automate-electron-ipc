# T41b: Vite / electron-vite plugin (`automate-electron-ipc/vite`)

Phase 4: Developer experience. Split from
[T41](./T41-programmatic-api-and-vite-electron.md).
Status and dependencies are in the [roadmap](../roadmap.md).

- **Decisions (from the architect review):**
  - Do not import `vite` at runtime and do not add it as a dependency or peer: type the plugin
    structurally (a local `interface VitePluginLike { name; buildStart?; configureServer?;
    handleHotUpdate? }` that is assignable to Vite's `Plugin`). `tests/packaging.test.ts` keeps
    asserting `electron` as the only peer.
  - electron-vite runs three Vite configs (main, preload, renderer) in one process, each with its
    own plugin instance. Generation is single-flight at module level: concurrent calls share one
    running `generate`, and a request during a run queues exactly one more run.
- **Scope:**
  - New `src/vite.ts`: `export function autoipc(options?: GenerateOptions): VitePluginLike`.
    - `buildStart`: `await generate(options)` (T41a), with `logger: true` unless the user set it.
      Errors fail the build (rethrow).
    - `configureServer(server)`: resolve the config once, then
      `server.watcher.add(watchedPaths(config, options.configFile))` (T40).
    - `handleHotUpdate({ file })`: when `file` is a schema source under the schema path or a config
      file (reuse T40's event filter; export it from `src/watch.ts` if it is not), regenerate and
      return `[]` for schema files so Vite does not reload the page for them. Errors are logged
      and do not crash the dev server.
  - `types/vite.d.ts` and the `./vite` entry in `package.json` `exports`.
- **Tests:** `tests/test_vite/plugin.test.ts` with a minimal plugin-container mock (call `buildStart`,
  `configureServer` with a fake `server.watcher`, `handleHotUpdate`): build runs `generate` once;
  watched paths are added; a schema edit regenerates; a non-schema file does not; an error in HMR
  is logged, not thrown; three instances calling `buildStart` concurrently run one generation;
  `tests/packaging.test.ts` covers the new export. Use fake timers / promises, no sleeps.
- **README:** an electron-vite setup snippet using the plugin (T48c writes the full example).
- **Follow-up IDs:** T154-T155.
- **Delivered:** 2026-10-09. `autoipc` in `src/vite.ts` (types in `types/vite.d.ts`, `./vite` in `exports`), with `classifyChange` exported from `src/watch.ts` as the shared event filter of `--watch` and `handleHotUpdate`. Runs are single-flight per project (`cwd`, `configFile`, `overrides`): `buildStart` joins a run that is going, so three instances started together run one generation, while `handleHotUpdate` queues exactly one more run after the one that is going. A relative `configFile` is resolved against `cwd`, as `--watch` does. No follow-ups, so T154-T155 are unused.
