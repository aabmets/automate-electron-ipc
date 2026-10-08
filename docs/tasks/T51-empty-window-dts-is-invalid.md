# T51: The empty `window.d.ts` is invalid

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the 2026-10-08 code review. With no channels,
  `RendererTypesWriter.renderEmptyFileContents` writes `declare global { interface Window {} }`
  with no import or export. tsc rejects it with TS2669 (global augmentations must be in a module).
- **Scope:** make the empty output a module (for example, add `export {};`).
- **Tests:** writer unit test on the text, plus an e2e fixture without channels that type-checks.
- **Delivered:**
