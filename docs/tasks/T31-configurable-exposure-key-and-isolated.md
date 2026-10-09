# T31: Configurable exposure key and isolated worlds

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** the API is hard-coded as `window.ipc`, and `contextBridge.exposeInIsolatedWorld` is
  unsupported.
- **Scope:**
  - Config `exposeAs` (default `"ipc"`).
  - Optional `isolatedWorldId` (validate ≥ 1000 per docs) that uses `exposeInIsolatedWorld`.
  - `window.d.ts` follows the key: the global `var` declaration from T13 uses the configured name.
    Validate that it is a valid identifier and does not clash with a well-known `window` property
    (`name`, `status`, `close`, `open`, ...).
- **Tests:** writer tests, plus an e2e type-check.
- **Delivered:** 2026-10-09. Config `exposeAs` and `isolatedWorldId` are validated, and the preload script and `window.d.ts` follow them. The reserved names are in `src/reserved-globals.ts`: JS reserved words, `window` properties, language globals and Node/Electron names. The `ipc` object of `main.ts` and `utility.ts` is not renamed, since it is not exposed to the page. `window.d.ts` stays a single global `var`, so a page in the main world can use the typed name; with an isolated world, it carries a comment that only that world has it. Not covered by a real-Electron test: whether a page can see the API in an isolated world depends on `webFrame.setIsolatedWorldInfo`, which the app owns.
