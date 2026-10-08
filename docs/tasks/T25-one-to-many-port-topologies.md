# T25: One-to-many port topologies

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** one port channel name supports exactly one pair of windows. A hub window with N child
  windows, or a "worker window" serving several UI windows, is impossible.
- **Scope:**
  - `ipc.<name>.connect(a, b)` returns a connection handle. A window may hold multiple connections
    per channel.
  - The renderer API gets `ipc.<name>.onConnection(cb)`. Each new peer arrives as its own
    connection object with `send`, `on` and `close` (T13's names), and `onConnection` returns a
    disposer.
- **Tests:** runtime tests with 1 hub and 3 peers, closing one peer.
- **Delivered:**
