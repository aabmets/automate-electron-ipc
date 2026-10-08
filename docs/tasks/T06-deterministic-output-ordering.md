# T06: Deterministic output ordering (B8)

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** schema files are read with `Promise.all` and pushed in completion order. The order of
  generated imports and members churns between runs.
- **Scope:** sort files by relative path. Keep the channel order stable within a file. Sort import
  declarations.
- **Tests:** running the generator twice (with shuffled `readdir` results via a mock) gives
  byte-identical output.
- **Delivered:**
