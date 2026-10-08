# T13: Naming of generated API members

Phase 2: Core API, listener lifecycle and security.
Status and dependencies are in the [index](./README.md).

- **Decision needed:** confirm the naming scheme with the user before starting. This is a breaking
  change to generated code; bump to 0.3.0.
- **Proposal:**
  - Main: Unicast uses `handle<X>`; Broadcast keeps `on<X>`.
  - Renderer: Unicast uses `invoke<X>`; Broadcast keeps `send<X>`.
  - Rename the exported `ipcMain` object (which shadows Electron's own `ipcMain`) to e.g. `ipc` or a
    configurable name.
- **Scope:**
  - Implement the chosen names.
  - Keep validation of `listeners` names consistent.
  - Document the migration in the README.
- **Tests:** writer unit tests, plus an e2e test.
- **Delivered:**
