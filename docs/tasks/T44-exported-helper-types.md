# T44: Exported helper types

Phase 4: Developer experience.
Status and dependencies are in the [index](./README.md).

- **Problem:** users cannot type wrappers or hooks generically.
- **Scope:** generated `window.d.ts` (or a `types.ts`) exports `IpcApi`, `ChannelName`,
  `ChannelArgs<N>` and `ChannelResult<N>`. Derive them with mapped types over `typeof` the exported
  channel maps from T00 (`import type`), handling both signature forms, instead of emitting each
  type as text.
- **Tests:** e2e type-level tests (`expectTypeOf`).
- **Delivered:**
