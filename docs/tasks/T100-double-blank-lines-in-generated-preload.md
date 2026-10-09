# T100: Two blank lines in a row between components of the generated `preload.ts`

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found while delivering T94. The components of `preload.ts` are joined as they are, so
  where one ends with an empty line and the next starts with one, the output has two blank lines in
  a row. The `ask-channels` fixture shows it between the error helpers and `askHandlers`. Other
  pairs, such as the timeout helpers followed by the error helpers, may do the same. Biome does not
  check generated code, so nothing reports it.
- **Scope:** make the components of the preload writer (and the others, if they share the problem)
  join with exactly one blank line, either by normalizing the join in `buildComponents` or by making
  the components consistent. Related to T65.
- **Tests:** a test over all fixtures that no generated file contains three newlines in a row, and
  updated exact-output tests where the text changes.
- **Delivered:**
