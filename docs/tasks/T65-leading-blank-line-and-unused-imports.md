# T65: Leading blank line and unused imports in generated files

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found during T10 and T52.
  - Every generated file starts with a blank line, because `dedent` keeps the leading newline of
    the notice template.
  - A schema with only port channels generates a `main.ts` that imports `ipcMain as
    electronIpcMain` without using it, which fails under `noUnusedLocals`.
- **Scope:** start generated files with the notice. Import from `electron` only what the generated
  code uses.
- **Tests:** writer unit tests on the text, plus an e2e type-check of the port-only fixture with
  `noUnusedLocals` enabled.
- **Delivered:**
