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
- **Delivered:** 2026-10-08. `write()` now strips leading newlines from the contents and the notice is
  trimmed, so no generated file starts with a blank line. `main.ts` imports `ipcMain as
  electronIpcMain` only when a RendererToMain channel exists (and no value import at all when nothing
  needs one). `preload.ts` needed no change, as every non-empty output uses both of its imports.
  The e2e `typecheck()` helper takes optional compiler options.
