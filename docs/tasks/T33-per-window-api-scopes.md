# T33: Per-window API scopes (least privilege)

Phase 3: Missing Electron features.
Status and dependencies are in the [index](./README.md).

- **Problem:** every window gets every channel. Apps with a privileged settings window and a sandboxed
  content/plugin window need different surfaces.
- **Scope:**
  - Per-channel `scopes: ["settings", "editor"]`. Unscoped channels are in a default scope.
  - Generate one preload plus one `.d.ts` per scope.
  - The main side can optionally reject calls from windows outside the scope, via a registry of
    `webContents` id → scope.
- **Tests:** writer tests per scope, plus runtime rejection tests.
- **Delivered:**
