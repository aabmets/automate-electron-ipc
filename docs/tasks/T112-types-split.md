# T112: Split `types/index.d.ts` and `types/internal.d.ts`

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:**
  - `types/index.d.ts` is 637 lines and is the published entry (`"types"` of `package.json`, shipped
    in `files`); `types/internal.d.ts` is 302 (alias `@types`).
  - Biome rejects both `export * from` and named re-exports in a `.d.ts` file (`noReExportAll`,
    `noBarrelFile`; checked when this task was written), so the published entry cannot simply gather
    several files.
- **Scope:** Decide how to split the published types (see the question), then split both files,
  keeping every exported name and the package's public types unchanged.
- **Tests:** `tests/packaging.test.ts` and `tests/types.test.ts` pass, the e2e type-check of the
  generated files passes, and the exported names of the published entry are the same before and
  after. `bun scripts/check-size.ts --update` lowers the baseline in the same commit.
- **Decision needed:** How should the published types be split, given that Biome forbids re-exports?
  Options: a Biome override that allows re-exports in `types/index.d.ts` only; the entry keeps its
  declarations and only `internal.d.ts` is split; or `package.json` `exports` / `typesVersions`
  points at several files.
- **Delivered:**
