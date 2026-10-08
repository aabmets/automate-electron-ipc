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
- **Delivered:** 2026-10-08. Module-level variables and functions (incl. destructured, overloaded, `export default function f`, `export { x as y }`) are recorded as `TypeSpec`s of the new kind `"value"`, so the existing import generation applies. A non-exported value that a signature queries fails with a "Value 'x' ... through 'typeof x' ... must be exported" error. Note: a type and a value that share a name (declaration merging) resolve to the first spec, and `typeof` is not distinguished from a type reference in `customTypes`, so the exported check covers both together.
