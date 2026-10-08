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
- **Delivered:** 2026-10-08. `ipc.<name>.on` and the new `ipc.<name>.once` of an `emit` channel register a wrapper that is created in the preload script and return `() => void`, which removes that wrapper with `ipcRenderer.removeListener`; `once` uses `ipcRenderer.once`, so its disposer also works before the message arrives. Port channels keep their `on` without a disposer; T24 reworks the port lifecycle. The fake `ipcRenderer` of the test utils gained `once` and `removeListener`.
