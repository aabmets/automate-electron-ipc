# T61: Types exported by `export { X }` or `export default class`

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found during T09.
  - `interface X {}` followed by `export { X }` (or `export { X as Y }`) is not recognised as
    exported. A channel that uses `X` fails validation with "User-defined types must be exported".
  - `export default class X {}` is not recorded as a type spec, so a channel that uses `X` gets no
    import.
- **Scope:** record export specifiers of local types (including renames, and `as default`), and
  record default-exported classes like T09's default-exported interfaces.
- **Tests:** parser and validator unit tests, plus an e2e fixture that type-checks.
- **Delivered:**
