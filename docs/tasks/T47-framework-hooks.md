# T47: Framework hooks (optional output)

Phase 4: Developer experience.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Scope:**
  - Config `hooks: "react" | "vue" | false` generates `useIpcEvent(name, cb)`, which subscribes and
    disposes on unmount, and `useIpcInvoke(name)`.
  - No framework dependency in the library itself.
- **Tests:** writer tests, plus an e2e type-check against `@types/react` / `vue` (dev deps).
- **Delivered:**
