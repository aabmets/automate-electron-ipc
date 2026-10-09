# T105: Split `main-bindings.ts`, part 3: ports, utility and brokered channels

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `src/writer/main-bindings.ts` is one class, `MainBindingsWriter`, of 3444 lines: the
  largest file by far, and the one that every feature task has grown. Four tasks (T103 to T106)
  split it, each leaving the output byte-identical. Line numbers below are those of the file when
  T102 was delivered.
- **Scope:** Move the port registry, the page-load watch, the renderer and main port helpers and
  channels (`buildMainPortHelpers` is ~230 lines), the utility helpers and channel, and the broker
  helpers and channel (lines ~1968 to 2672), following the pattern of T103.
- **Tests:** No assertion changes. The generated output of every fixture in `tests/fixtures` is
  byte-identical before and after (dump it into the scratchpad first, then `diff -r`), the whole
  suite passes, and `bun scripts/check-size.ts --update` lowers the baseline in the same commit.
- **Delivered:**
