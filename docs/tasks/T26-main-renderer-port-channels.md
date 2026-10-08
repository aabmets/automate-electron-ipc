# T26: Main ↔ renderer port channels

Phase 3: Missing Electron features.
Status and dependencies are in the [index](./README.md).

- **Problem:** high-frequency data such as log tailing, audio meters or progress pays per-message
  `ipcMain` overhead. Electron recommends `MessagePortMain` for this, but no main-side port endpoint
  is generated.
- **Scope:**
  - New schema kind for a main ↔ renderer port.
  - The main gets a typed `MessagePortMain` wrapper (`start()`, `postMessage`, `on('message')`,
    `'close'`).
  - The renderer gets the same API as T24.
- **Tests:** runtime tests with a mocked `MessageChannelMain`.
- **Delivered:**
