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
- **Delivered:**
