# T109: Split `parser.ts`, part 2: channel maps, imports, definitions and `parseSpecs`

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** What is left of `src/parser.ts` after T108.
- **Scope:**
  - Move out the library import and verb tables (`collectLibraryImports`, `VERBS`), the channel
    option, config and map parsing (`parseOption` to `parseChannelMapModule`, lines ~1075 to 1500),
    the import declaration and import-equals parsing, the value and type definition parsing,
    `applyExportSpecifiers` and `parseSpecs`.
  - `parser.ts` ends within the limit and leaves the baseline.
- **Tests:** No assertion changes. The generated output of every fixture in `tests/fixtures` is
  byte-identical before and after (dump it into the scratchpad first, then `diff -r`), the whole
  suite passes, and `bun scripts/check-size.ts --update` lowers the baseline in the same commit.
- **Delivered:**
