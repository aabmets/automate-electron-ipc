# T50: E2E type-check must cover `window.d.ts`

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the 2026-10-08 code review. The e2e harness (`tests/utils/e2e-utils.ts`)
  sets `skipLibCheck: true`, which skips every `.d.ts` file, including the generated
  `window.d.ts`. Missing imports, unknown names and duplicate identifiers in `window.d.ts` are never
  reported, so every e2e type-check so far covered only `main.ts` and `preload.ts`.
- **Scope:** make the e2e type-check report errors in the generated `window.d.ts`, while still not
  type-checking third-party declarations (for example, by checking the generated file without
  `skipLibCheck`, or by type-checking it through a `.ts` file). Fix any existing fixture that turns
  out not to type-check.
- **Tests:** a harness test that a `window.d.ts` with a broken import makes `typecheck()` report
  an error.
- **Delivered:**
