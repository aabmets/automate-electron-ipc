# T104: Split `main-bindings.ts`, part 2: channels, `ask` and streams

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `src/writer/main-bindings.ts` is one class, `MainBindingsWriter`, of 3444 lines: the
  largest file by far, and the one that every feature task has grown. Four tasks (T103 to T106)
  split it, each leaving the output byte-identical. Line numbers below are those of the file when
  T102 was delivered.
- **Scope:**
  - Move the renderer-to-main channels and their listeners (`buildRendererToMainChannel`,
    `buildOuterListener`, the decoded and validated listeners, the sender helpers), the
    main-to-renderer channels, the `ask` helpers and channel with the event watch, the stream
    helpers and the trigger binder (lines ~1058 to 1966), following the pattern of T103.
  - `buildAskHelpers` and `buildStreamHelpers` are ~200 and ~140 lines each; check whether they need
    a seam of their own.
- **Tests:** No assertion changes. The generated output of every fixture in `tests/fixtures` is
  byte-identical before and after (dump it into the scratchpad first, then `diff -r`), the whole
  suite passes, and `bun scripts/check-size.ts --update` lowers the baseline in the same commit.
- **Delivered:**
