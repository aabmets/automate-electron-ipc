# T48c: README electron-vite example, preload bundling and sandbox notes

Phase 4: Developer experience. Split from [T48](./T48-readme-rewrite.md).
Status and dependencies are in the [roadmap](../roadmap.md).

- **Scope:** (edit only these sections; T48b and T48d own the others)
  - A new "electron-vite end to end" section: project layout, `electron.vite.config.ts` with the
    `autoipc()` plugin (T41b) in all three configs, the main process wiring, the preload entry,
    a renderer component calling the API, and the tsconfig split. Tag the TypeScript parts as one
    `readme-example` (T48a harness); the Vite config itself is shown but not type-checked if it
    needs `electron-vite` types (say so in a comment in the test).
  - Rewrite "Composing the preload script" into "Preload bundling and the sandbox": sandboxed
    preloads cannot `require` local files, so the preload must be bundled; what the generated
    preload imports; `autoExpose` and composing with an existing preload; `isolatedWorldId`.
- **Tests:** the README example check passes.
- **Follow-up IDs:** T176-T177.
- **Delivered:** 2026-10-10. "Composing the preload script" is now "Preload bundling and the sandbox": what a sandboxed
  preload can `require`, what the generated preload imports (`electron` only, plus the `serializer`
  module, which the bundler must inline), CommonJS output, `autoExpose` and composing with an own
  preload, and `isolatedWorldId`. The new "electron-vite end to end" section has the layout, the plugin
  in the three builds, and the schema, main, preload and renderer files as one `readme-example`
  (`electron-vite`); the composed preload is a second one (`preload-compose`, with `autoExpose: false`).
  The Vite config is shown without a tag, since checking it needs `electron-vite`; a comment in
  `readmeExamples.test.ts` says so. The Electron-side claims (the modules of a sandboxed `require`, ES
  module preloads needing `sandbox: false`, the `exclude` of `externalizeDepsPlugin`) come from the
  Electron and electron-vite docs, not from a test here.
