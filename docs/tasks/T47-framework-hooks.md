# T47: Framework hooks (optional output)

Phase 4: Developer experience.
Status and dependencies are in the [roadmap](../roadmap.md).

> **Split** (architect review, 2026-10-09) into the parts listed in the roadmap. Each part's file is
> the plan to build from; this file keeps the original scope for reference.

- **Scope:**
  - Config `hooks: "react" | "vue" | false` generates `useIpcEvent(name, cb)`, which subscribes and
    disposes on unmount, and `useIpcInvoke(name)`.
  - No framework dependency in the library itself.
- **Tests:** writer tests, plus an e2e type-check against `@types/react` / `vue` (dev deps).
- **Delivered:**
