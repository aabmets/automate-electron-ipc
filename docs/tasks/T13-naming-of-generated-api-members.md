# T13: Naming of generated API members

Phase 2: Core API, listener lifecycle and security.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Decided (2026-10-08):**
  - The generated API is a per-channel namespace: each channel is an object named after its key in
    the `defineChannels` map (T00), and its actions are methods on that object.
  - The main-process export is renamed from `ipcMain` (which shadows Electron's own `ipcMain`) to
    `ipc`, matching the renderer's `window.ipc`.
  - The `listeners` option is dropped (removed from the schema in T00). Multiple subscribers call
    `.on()` more than once.
  - This is a breaking change to generated code; it ships in 0.3.0 together with T00.
- **Names, by schema verb:**

  | Verb | Main (`ipc` from `main.ts`) | Renderer (global `ipc`, also `window.ipc`) |
  |---|---|---|
  | `invoke` | `ipc.<name>.handle(cb)` | `ipc.<name>.invoke(...args)` |
  | `send` | `ipc.<name>.on(cb)` | `ipc.<name>.send(...args)` |
  | `emit` | `ipc.<name>.send(target, ...args)` | `ipc.<name>.on(cb)` |
  | `port` | `ipc.<name>.connect(winA, winB)` | `ipc.<name>.send(...args)`, `ipc.<name>.on(cb)` |

  - Ports join the same namespace; the separate `ports` object and the `propagate`, `sendMessage`
    and `onMessage` names are removed.
  - If T12 has landed, its trigger binder moves to `ipc.<name>.bind(win, provider)`.
  - Later tasks add methods on the channel object, never new top-level members:
    `once` (T14), `once`/`handleOnce` (T15), `broadcast` (T21), `sendToSender` (T22), the `ask`
    verb (T23), `stream` (T27).
- **Scope:**
  - Rewrite the three writers (`main-bindings.ts`, `preload-bindings.ts`, `renderer-types.ts`) to
    emit one object per channel with the methods above, typed from the signature.
  - The empty-file output exports `ipc` (`export const ipc = {};`).
  - Make the renderer API usable as a bare global, `ipc.<name>.invoke(...)`, as well as through
    `window.ipc`. `exposeInMainWorld` already puts it on the renderer's global object; only the
    typing is missing. `window.d.ts` declares it with `declare global { var ipc: IpcApi }` instead
    of an `interface Window` member, which types `ipc`, `window.ipc` and `globalThis.ipc` alike.
  - Remove all remaining `listeners` handling from the writers and validators.
  - Reject channel names that would clash with built-in object members (`constructor`,
    `__proto__`, `toString`, ...), naming the file and the channel.
  - Document the new API and a migration table from 0.2 names in the README.
- **Tests:**
  - Writer unit tests for each verb, asserting on the generated text.
  - An e2e test that the generated files type-check, that `ipc.<name>` exposes only the methods its
    verb allows, and that both `ipc` and `window.ipc` are typed in renderer code.
  - A validator test for the reserved-name check.
- **Delivered:**
