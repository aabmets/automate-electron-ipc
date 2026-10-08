# T66: swc spans are UTF-8 byte offsets, so non-ASCII source corrupts the output

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the review of Phases 0 and 1. `parseModule` builds `Source.text` with
  `code.slice(span.start - 1, span.end - 1)`, but swc spans are byte offsets into the UTF-8 source,
  while `slice` takes UTF-16 indices. Any non-ASCII character before a signature (a comment such as
  `// Käyttäjä`, a string literal, a type name like `Üser`, or a UTF-8 BOM, which most Windows
  editors write) shifts every later slice. The generator does not fail: it writes garbled
  `main.ts` and `window.d.ts` (for example `callback: "é") => Promise<Üser>>(event: ...`) that tsc
  rejects. Reproduce: `parseSync("// é\nconst a = 1;")` gives span 7..19, and slicing yields
  `"onst a = 1;"`.
  `findParamsStart` has the same flaw: it mixes the byte offsets `typeParams.span.end` and
  `fn.span.start` into an index of the decoded text.
- **Scope:**
  - Make `Source.text` convert spans correctly (slice the UTF-8 bytes and decode, or map byte
    offsets to string indices once per parse).
  - Compute the `findParamsStart` offset from text, not from a difference of byte offsets.
  - Check the BOM case: the BOM must not shift anything.
- **Tests:** parser unit tests with non-ASCII text in a comment before the map, in a string literal
  type, in a type name, in a comment inside the type parameters, and a file with a BOM. An e2e
  fixture with non-ASCII text that type-checks and asserts the generated signatures.
- **Delivered:** 2026-10-08. `parseModule` now slices the UTF-8 bytes of the source (after dropping a leading BOM, which swc does not count) and decodes them, and `findParamsStart` measures the skipped type parameters as decoded text. New `parseModule` unit tests and a `non-ascii` e2e fixture (BOM, comments, literals, type names) that type-checks.
