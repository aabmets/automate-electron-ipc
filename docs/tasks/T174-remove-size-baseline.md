# T174: Remove the size baseline

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `size-baseline.json` has been `{}` since the split tasks finished, but the gate
  still carries the ratchet logic (`readBaseline`, `writeBaseline`, `ratchet`, `snapshot`,
  `--update`), its tests and its documentation.
- **Scope:** Delete `size-baseline.json` and the baseline logic of `scripts/size-gate.ts`: a file
  over the hard limit is an error, with no exceptions. Update `CLAUDE.md`, the roadmap and the
  `module-structure` skill.
- **Tests:** `tests/size-gate.test.ts` keeps the line counting, the limits and the on-disk run, and
  loses the baseline and ratchet cases.
- **Delivered:** 2026-10-10. The `--update` flag is gone as well, and `run` takes only `cwd`.
