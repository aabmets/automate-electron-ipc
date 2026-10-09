# T107: Split `preload-bindings.ts`

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `src/writer/preload-bindings.ts` is 1486 lines, again one class
  (`PreloadBindingsWriter`). Two of its methods are near the limit alone: `getPortComponents` (~260
  lines) and `buildUtilityClientComponents` (~275 lines).
- **Scope:**
  - Split along the features: invoke, timeouts and serializer components; subscriptions; `ask` and
    error components; stream channel, reader and components; utility and brokered clients; port
    components. The two long methods need a seam inside.
  - Follow the composition pattern that T103 set, if it has landed; otherwise choose one by the
    skill and record it.
  - If one session cannot hold it, split it into `T107a`, `T107b` (see `CLAUDE.md`).
- **Tests:** No assertion changes. The generated output of every fixture in `tests/fixtures` is
  byte-identical before and after (dump it into the scratchpad first, then `diff -r`), the whole
  suite passes, and `bun scripts/check-size.ts --update` lowers the baseline in the same commit.
- **Delivered:**
