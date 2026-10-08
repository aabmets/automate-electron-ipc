# T09: Type-definition edge cases

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:**
  - Any non-exported type in a schema file throws, even if no channel uses it.
  - `export default interface X` is imported as `import type { X }`, which is wrong.
  - Generic type params (`<T>(x: T) => T`) are collected as custom types.
  - `ImportsGenerator` never marks local typeSpec imports as seen, so they can be duplicated.
  - Built-in global types (`Array`, `Record`, `Map`, `Date`, `Uint8Array`, ...) are treated as
    custom types.
- **Scope:**
  - Only require `export` on types that are actually referenced by a channel.
  - Fix default-export imports.
  - Exclude in-scope generic params and well-known globals.
  - Dedupe local type imports.
- **Tests:** parser and imports-generator unit tests for each case, plus an e2e type-check.
- **Delivered:** 2026-10-08. Export is checked in `validateTypeSpecs` against the channel signatures, not per declaration; added `TypeSpec.isDefault`. Known limits: a schema that declares or imports its own `Map`, `Error` and the like is not supported (the name counts as a global), and `export { X }` does not count as exporting a local type. Follow-up for the writer area: the renderer-types and main writers drop `<T>` when they rebuild non-async signatures.
