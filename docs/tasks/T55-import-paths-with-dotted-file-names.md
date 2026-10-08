# T55: Import paths with dots in the file name are truncated

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the 2026-10-08 code review. `ImportsGenerator.getImportPath` strips
  whatever follows the last dot, so `"./types/user.model"` becomes `"./types/user"` (TS2307).
- **Scope:** strip only real script extensions (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`,
  `.mjs`, `.cjs`), mapping each to the right output extension under NodeNext.
- **Tests:** imports-generator unit tests, plus an e2e fixture that type-checks.
- **Delivered:** 2026-10-08. As scoped. Local schema file names with dots (`user.model.ts`) are handled too.
