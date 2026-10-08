# T10: Stale metadata and packaging dependencies (B10)

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:**
  - `types/internal.d.ts` imports a non-existent `IpcAutomationPlugin`.
  - The README says "uses the TypeScript library" (it uses swc).
  - The generated notice says "PLUGIN".
  - `chalk`, `commander` and `superstruct` are runtime imports but are declared as
    peerDependencies, so users must install them by hand.
  - `electron` is not needed by the generator.
- **Scope:**
  - Remove the stale export.
  - Fix the wording.
  - Move runtime deps to `dependencies`, or replace `chalk` with `node:util.styleText`.
  - Make `electron` an optional peer.
- **Tests:** a test that imports `cli.ts`/`automation.ts` with only `dependencies` available
  (assert `package.json` deps cover every bare import in `src/`).
- **Delivered:**
