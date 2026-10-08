# T20: Channel name prefix / namespacing

Phase 2: Core API, listener lifecycle and security.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** raw channel names like `GetUser` can collide with other libraries or app code using
  `ipcMain` directly.
- **Scope:** add a config option `channelPrefix` (default e.g. `"autoipc:"`) applied to the wire
  channel names only. API member names are unchanged.
- **Tests:** writer tests, plus an e2e test.
- **Delivered:**
