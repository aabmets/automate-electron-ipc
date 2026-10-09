# T108: Split `parser.ts`, part 1: AST helpers, signatures, clone check and diagnostics

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `src/parser.ts` is 1780 lines of free functions. It is split over T108 and T109; line
  numbers are those of the file when T102 was delivered.
- **Scope:**
  - Move out the module and AST helpers (`parseModule`, `forEachChild`, the built-in type sets,
    `collectModuleBindings`, `collectCustomTypes`, `collectTypeDeclarations`), the signature parsing
    (`parseSignature`, the parameter, `Promise`, void and stream helpers), the structured-clone
    check (`UNCLONABLE_GLOBALS` to `walkCloneType`, lines ~610 to 837), and the diagnostics
    (`SchemaError`, `describeSyntaxError`, `SchemaSyntaxError`, lines ~920 to 1074).
  - Callers import the functions from their new modules (src and tests): Biome forbids leaving a
    re-exporting `parser.ts` behind.
- **Tests:** No assertion changes. The generated output of every fixture in `tests/fixtures` is
  byte-identical before and after (dump it into the scratchpad first, then `diff -r`), the whole
  suite passes, and `bun scripts/check-size.ts --update` lowers the baseline in the same commit.
- **Delivered:**
