# T32: Composable preload output

Phase 3: Missing Electron features.
Status and dependencies are in the [index](./README.md).

- **Problem:** the generated `preload.ts` calls `exposeInMainWorld` as a side effect, so it cannot be
  combined with app-specific preload code or exposed under several keys.
- **Scope:**
  - Export `const api = {...}` and `export function expose(key = "<exposeAs>")`.
  - Keep a config switch to auto-expose for backward compatibility.
- **Tests:** writer tests, plus a runtime test with a mocked `contextBridge`.
- **Delivered:**
