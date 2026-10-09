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
- **Delivered:** 2026-10-09. All five files are under the limit and their baseline entries are removed.
  `utility-runtime.ts` gave `utility-peer.ts`; `utility-bindings.ts` gave `utility-broker.ts`;
  `renderer-types.ts` gave `renderer-declaration.ts` (which now holds `ChannelEntry`);
  `imports-generator.ts` gave `import-paths.ts` (`ImportPathResolver`); `base-writer.ts` gave
  `rename-signatures.ts`, `channel-kinds.ts` (the `is*Spec` and `has*Channels` predicates, now plain
  functions, with one `hasBrokeredChannels` for the two writers that had a copy each), and
  `param-names.ts`; `buildSerializerImport` moved to `utility-runtime.ts`. The protected methods that
  tests or subclasses reach (`getChannelSpecs`, `getOriginalParams`, `isSerializedSpec`, ...) stay on
  `BaseWriter`. The generated output of every fixture is byte-identical (98 projects diffed).
  `main-bindings.ts` is at 270 lines of code after taking the new imports.
