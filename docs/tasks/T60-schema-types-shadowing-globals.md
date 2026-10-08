# T60: Schema types that shadow built-in globals

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found during T09. `isBuiltinType` treats `Map`, `Error`, `Date` and the other
  well-known globals as built-in by name. A schema that declares or imports its own type of such a
  name gets no import, so the generated files silently use the global type instead.
- **Scope:** a name that the schema file declares or imports takes precedence over the built-in
  list. Only names with no local binding are treated as globals.
- **Tests:** parser and imports-generator unit tests, plus an e2e fixture with a schema `Error`
  type that type-checks and asserts the import.
- **Delivered:** 2026-10-08. A module's own imports and type declarations (`collectModuleBindings`) now
  take precedence over the global list in signatures and in the recorded imports; type keywords stay
  built in. A declared `Promise` is also not detected as async, and the generated code reserves
  `Promise` and `Awaited`, so a schema type of that name is imported under an alias.
