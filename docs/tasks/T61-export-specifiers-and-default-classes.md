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
- **Delivered:** 2026-10-08. `export { X }`, `export type { X }`, `export { X as Y }`,
  `export { X as default }` and `export default X` now mark the local type as exported (a rename is
  recorded as `exportedAs` and imported as `Y as X`). `export default class X {}` is recorded as a
  default-exported class; an anonymous default class declares no name and is ignored. Re-exports
  with a `from` source are not local types and stay ignored.
