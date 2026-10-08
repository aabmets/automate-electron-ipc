# T31: Configurable exposure key and isolated worlds

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** the API is hard-coded as `window.ipc`, and `contextBridge.exposeInIsolatedWorld` is
  unsupported.
- **Scope:**
  - Config `exposeAs` (default `"ipc"`).
  - Optional `isolatedWorldId` (validate ≥ 1000 per docs) that uses `exposeInIsolatedWorld`.
  - `window.d.ts` follows the key.
- **Tests:** writer tests, plus an e2e type-check.
- **Delivered:**
