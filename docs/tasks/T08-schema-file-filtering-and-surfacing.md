# T08: Schema file filtering, and surfacing parse errors

Phase 1: Bug fixes.
Status and dependencies are in the [index](./README.md).

- **Problem:**
  - Every file under `schema/` is read, including `.md`, `.json`, etc.
  - swc parse errors are swallowed, so a typo produces "no channels found" instead of an error.
- **Scope:**
  - Only read `*.ts`, `*.mts` and `*.cts`, ignoring `*.d.ts`.
  - Report parse errors with file path and line:column, and exit non-zero.
- **Tests:** unit tests for the filter. A regression test that a syntax error is reported, not
  ignored.
- **Delivered:**
