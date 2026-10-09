# T111: Split the remaining writer modules

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** Five more files in `src/writer/` are over the limit: `utility-bindings.ts` (488),
  `base-writer.ts` (463), `imports-generator.ts` (441), `utility-runtime.ts` (419) and
  `renderer-types.ts` (336).
- **Scope:**
  - Split each along its feature seams, as the skill describes. `base-writer.ts` is the base of the
    other writers: what several writers share belongs there or in one shared module, so look at it
    before the others and keep its public surface.
  - If one session cannot hold five files, split it into `T111a`, `T111b` (see `CLAUDE.md`).
- **Tests:** No assertion changes. The generated output of every fixture in `tests/fixtures` is
  byte-identical before and after (dump it into the scratchpad first, then `diff -r`), the whole
  suite passes, and `bun scripts/check-size.ts --update` lowers the baseline in the same commit.
- **Delivered:**
