# T32: Composable preload output

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** the generated `preload.ts` calls `exposeInMainWorld` as a side effect, so it cannot be
  combined with app-specific preload code or exposed under several keys.
- **Scope:**
  - Export `const api = {...}` and `export function expose(key = "<exposeAs>")`.
  - Keep a config switch to auto-expose for backward compatibility.
- **Tests:** writer tests, plus a runtime test with a mocked `contextBridge`.
- **Delivered:** 2026-10-09. `preload.ts` now exports `api` and `expose(key = "<exposeAs>")`, which uses `exposeInIsolatedWorld` when `isolatedWorldId` is set. The new config `autoExpose` (default `true`) keeps the old behavior of exposing on load by emitting a trailing `expose();`; `false` omits it. `expose` takes only the key: the world stays the configured one. `window.d.ts` is unchanged, so extra keys are not typed. Covered by writer, validator, config, runtime (fake `contextBridge`) and e2e type-check tests (fixture `compose-preload`), and the real-Electron suite still passes.
