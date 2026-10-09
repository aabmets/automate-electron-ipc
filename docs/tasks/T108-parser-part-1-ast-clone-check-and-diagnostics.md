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
- **Delivered:** 2026-10-09. Seven flat modules with named exports, no barrel: `ast.ts` (node
  types, `parseModule`, `forEachChild`, the `unwrap*` helpers), `builtin-types.ts` (the keyword and
  global type sets, `isBuiltinType`), `module-bindings.ts` (`isTypeDefinition`, `declarationOf`,
  `TYPE_KINDS`, `collectModuleBindings`, `collectTypeDeclarations`), `type-references.ts`
  (`collectCustomTypes`), `clone-check.ts` (the structured-clone walk), `signature.ts`
  (`parseSignature` and its helpers) and `diagnostics.ts` (`SchemaError`, `SchemaSyntaxError`,
  `describeSyntaxError`). `parser.ts` shrinks from 1780 to 850 lines and its default export lists
  only what is left, so tests and `automation.ts` import the moved functions from the new modules.
  The output of all 95 fixtures is byte-identical. Deviations: `isTypeDefinition`, `declarationOf`
  and `TYPE_KINDS` moved too, since `collectModuleBindings` needs them and T109 would otherwise
  import them back from `parser.ts`; the `describeSyntaxError` tests moved to
  `tests/test_parser/describeSyntaxError.test.ts` (same tests, 634 in `tests/test_parser` before
  and after), and a few test helpers were shortened, because the extra import lines would have
  grown five baselined test files. Two test helpers import `collectCustomTypes` and
  `parseSignature` under an alias, as their own names clash.
