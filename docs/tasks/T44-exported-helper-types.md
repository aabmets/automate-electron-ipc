# T44: Exported helper types

Phase 4: Developer experience.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** users cannot type wrappers or hooks generically.
- **Scope:** a new generated `types.ts`, next to the other generated files, exports `IpcApi`,
  `ChannelName`, `ChannelArgs<N>` and `ChannelResult<N>`. Derive them with mapped types over
  `typeof` the exported channel maps from T00 (`import type`), handling both signature forms,
  instead of emitting each type as text. A separate file lets main-process code import them too;
  importing `window.d.ts` from main would wrongly declare the renderer's global `ipc` there.
- **Tests:** e2e type-level tests (`expectTypeOf`).
- **Delivered:**
