# T62: `typeof` of a value declared in the schema file

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found during T54. `typeof x` resolves `x` against imports only. When `x` is a
  `const`, `function` or `class` declared in the schema file itself, no import is generated and
  the generated files fail with "Cannot find name 'x'".
- **Scope:** record exported value declarations of the schema file, and import them with
  `import type { x }` where a signature refers to them through `typeof`. Require `export` for
  values used this way, with a clear error otherwise.
- **Tests:** parser and imports-generator unit tests, plus an e2e fixture that type-checks.
- **Delivered:**
