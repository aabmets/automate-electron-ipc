# T39: `ipcgen --check`

Phase 4: Developer experience.
Status and dependencies are in the [index](./README.md).

- **Problem:** CI cannot detect stale generated files.
- **Scope:**
  - Render in memory and compare with the files on disk. Exit 1 with a list of stale files; write
    nothing.
  - Embed a schema hash in the notice header.
- **Tests:** e2e: fresh → 0, schema edited → 1, no writes in check mode.
- **Delivered:**
