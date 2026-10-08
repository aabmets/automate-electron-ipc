# T35: `getPathForFile` helper

Phase 3: Missing Electron features.
Status and dependencies are in the [index](./README.md).

- **Problem:** `File.path` was removed in Electron 32. Drag-and-drop apps must call
  `webUtils.getPathForFile` in the preload.
- **Scope:** a config flag adds `getPathForFile(file: File): string` to the exposed API (sandbox-safe).
- **Tests:** writer test, plus a runtime test with a mocked `webUtils`.
- **Delivered:**
