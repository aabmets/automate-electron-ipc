# T25: One-to-many port topologies

Phase 3: Missing Electron features.
Status and dependencies are in the [index](./README.md).

- **Problem:** one port channel name supports exactly one pair of windows. A hub window with N child
  windows, or a "worker window" serving several UI windows, is impossible.
- **Scope:**
  - `connect<X>(a, b)` returns a connection handle. A window may hold multiple connections per
    channel.
  - The renderer API exposes connections (e.g. `onConnection(cb)`), each with
    `sendMessage`/`onMessage`/`close`.
- **Tests:** runtime tests with 1 hub and 3 peers, closing one peer.
- **Delivered:**
