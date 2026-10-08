# T40: `ipcgen --watch`

Phase 4: Developer experience.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Scope:**
  - Watch the schema file/dir (recursive) and the referenced type files.
  - Debounce, regenerate, and keep running on errors (print them).
- **Tests:** e2e with a temp dir: edit triggers regeneration; a syntax error does not kill the
  watcher.
- **Delivered:**
