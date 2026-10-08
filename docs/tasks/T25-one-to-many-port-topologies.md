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
- **Delivered:** 2026-10-08. Notes:
  - The main process already allowed several `connect` calls with one window in common. What failed
    was the preload, which kept one port per channel, so each new peer replaced the last. `connect`
    now gives every end of a connection a key (`<id>:a`, `<id>:b`), which is the message data that
    carries its port (it was `null`) and the argument of `<channel>:close`. The preload keeps a map of
    connections by key: a known key is a new port for that connection (a reload of the peer, as in
    T24), an unknown key is a new connection.
  - `ipc.<name>.onConnection(cb)` runs for every connection with `{ send, on, onReady, onClose,
    close }` and returns a disposer. Deviation: it also runs at once for the connections that exist,
    like `onReady` does for a port, since a page can register after the ports have arrived.
  - `close()` of a connection must end it for good, or a reload would pair it again. So the main
    process also listens on `<channel>:disconnect` (registered by the first `connect` of a channel),
    and the preload sends the key there. Main ends the connection only if the sender is the window
    that holds that end, and tells both windows. `send` of a closed connection is dropped.
  - The channel-level `send`/`on`/`onReady`/`onClose` of T24 stay, as the aggregate of all
    connections: `send` goes to every connection, and queues while there is none, for the first one
    that comes. This was not in the scope of the task; the alternative was to break the single-peer
    use of T24.
  - Not done: a renderer-side `close()` races with a pair that is already in flight (the ghost
    connection is torn down by the `:close` that follows). Tests use the real `MessageChannel` of
    Node for the preload script and fakes for the main process; nothing was run in Electron.
