# T42: Diagnostics

Phase 4: Developer experience.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:**
  - Raw superstruct `StructError`s surface to users without file or position.
  - Typos in config keys (`listner`) are silently ignored.
- **Scope:**
  - All schema errors report `file:line:col` with a code frame from swc spans.
  - Unknown keys in channel configs are errors.
  - Multiple errors are collected and reported together.
- **Tests:** snapshot tests of error output for representative mistakes.
- **Delivered:**
