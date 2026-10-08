# T28: Invoke timeouts

Phase 3: Missing Electron features.
Status and dependencies are in the [index](./README.md).

- **Problem:** a hung main handler leaves the renderer's promise pending forever.
- **Scope:**
  - Per-channel `timeoutMs` schema option, plus a global default in config.
  - The preload races the invoke and rejects with `IpcTimeoutError`.
- **Tests:** runtime tests with fake timers.
- **Delivered:**
