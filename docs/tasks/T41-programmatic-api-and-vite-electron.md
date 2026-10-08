# T41: Programmatic API and Vite / electron-vite plugin

Phase 4: Developer experience.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** no programmatic entry; `index.ts` exports only the schema DSL.
- **Scope:**
  - Export `generate(options)` and `check(options)` from a `automate-electron-ipc/api` subpath.
  - Add a Vite plugin at `automate-electron-ipc/vite` that runs on `buildStart` and regenerates on
    schema HMR.
  - Update `package.json` `exports`.
- **Tests:** API unit tests, plus a plugin test with a minimal Vite plugin-container mock.
- **Delivered:**
