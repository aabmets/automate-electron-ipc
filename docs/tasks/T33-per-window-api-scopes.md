# T33: Per-window API scopes (least privilege)

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** every window gets every channel. Apps with a privileged settings window and a sandboxed
  content/plugin window need different surfaces.
- **Scope:**
  - Per-channel `scopes: ["settings", "editor"]`. Unscoped channels are in a default scope.
  - Generate one preload plus one `.d.ts` per scope.
  - The main side rejects calls to a scoped channel from windows outside its scope, via a registry
    of `webContents` id → scope that windows using a scope must be registered in. Unscoped channels
    stay open to all windows.
- **Tests:** writer tests per scope, plus runtime rejection tests.
- **Delivered:**
