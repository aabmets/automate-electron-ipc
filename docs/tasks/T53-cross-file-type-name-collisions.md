# T53: Type names that collide across schema files

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the 2026-10-08 code review. `ImportsGenerator` dedupes imports by local
  name only, not by source module.
  - Two schema files that each export their own `User` generate two `import type { User }` lines
    (TS2300 duplicate identifier).
  - If `a.ts` imports `User` from `../types/m` and `b.ts` declares its own `User`, the second import
    is dropped and `b.ts`'s channels are silently typed with the wrong `User`.
- **Scope:** dedupe by (source module, exported name). When two different types share a local name,
  import them under unique aliases and use the alias in the generated signatures of the channels
  that refer to them. Same for namespace imports that share an alias but point to different modules.
- **Tests:** imports-generator unit tests, plus e2e fixtures for both cases that type-check and
  assert each channel uses its own type.
- **Delivered:**
