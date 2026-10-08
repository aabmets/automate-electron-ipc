# T05: Wrong generated types (B6, B7)

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

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
- **Delivered:** 2026-10-08. Handler wrappers now take the declared params explicitly, so no `any` casts remain. The wrapper and callback names (`event`, `callback`) are chosen to not shadow signature names; T57 covers the rest of the clash handling. Broadcast senders are `void` even if the declared return is `Promise<void>`.
