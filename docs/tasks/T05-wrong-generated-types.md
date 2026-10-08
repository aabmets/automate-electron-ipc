# T05: Wrong generated types (B6, B7)

Phase 1: Bug fixes.
Status and dependencies are in the [index](./README.md).

- **Problem:**
  - Unicast handlers in `main.ts` type the event as `IpcMainEvent`; Electron passes
    `IpcMainInvokeEvent`.
  - RendererToMain Broadcast senders are typed `=> Promise<void>` in `window.d.ts` but call
    `ipcRenderer.send`, which returns `undefined`.
- **Scope:**
  - Use `IpcMainInvokeEvent` for Unicast.
  - Type Broadcast senders as returning `void`.
  - Drop the `any` casts in the `main.ts` handler wrappers where feasible, so the declared signature
    is actually enforced.
- **Tests:** writer unit tests, plus an e2e type-check.
- **Delivered:**
