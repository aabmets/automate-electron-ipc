# T35: `getPathForFile` helper

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `File.path` was removed in Electron 32. Drag-and-drop apps must call
  `webUtils.getPathForFile` in the preload.
- **Scope:** a config flag adds `getPathForFile(file: File): string` to the exposed API (sandbox-safe).
- **Tests:** writer test, plus a runtime test with a mocked `webUtils`.
- **Delivered:** 2026-10-09. The new config `getPathForFile` (boolean, default `false`) adds `getPathForFile(file: File): string` to `api` in `preload.ts`, a wrapper of `webUtils.getPathForFile`, and declares it in `IpcApi` of `window.d.ts`. It is in every scope's file and in the empty API too. A schema channel of the same name is refused while the flag is on (`validateReservedApiNames`). Covered by writer, validator, config, runtime (fake `webUtils`) and e2e type-check tests (fixture `path-for-file`), and by a real-Electron test in which a sandboxed page gets the path of a file from a file input. No follow-ups.
