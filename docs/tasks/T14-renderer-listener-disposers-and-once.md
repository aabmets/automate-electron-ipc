# T14: Renderer listener disposers and `once`

Phase 2: Core API, listener lifecycle and security.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:**
  - Preload `ipc.<name>.on` returns the `ipcRenderer` object and cannot be unsubscribed.
  - Since contextBridge re-proxies functions on every crossing, a separate `off(cb)` cannot work.
  - Frameworks (React StrictMode, Vue/Svelte remounts) accumulate duplicate listeners.
- **Scope:**
  - The preload wrapper keeps its own reference and returns
    `() => ipcRenderer.removeListener(ch, wrapper)`, typed `() => void` in `window.d.ts`.
  - Generate `ipc.<name>.once`. The callback still never receives the `IpcRendererEvent`.
- **Tests:**
  - Writer unit tests.
  - A runtime test of the generated preload with a mocked `ipcRenderer`/`contextBridge`: subscribe,
    dispose, no further calls.
  - Assert the returned value is a function, not `ipcRenderer`.
- **Delivered:**
