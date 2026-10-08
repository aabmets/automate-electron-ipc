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
- **Delivered:** 2026-10-08. The stale `IpcAutomationPlugin` import and the README "TypeScript library" wording were already gone at this base, so only regression assertions were added. `chalk` replaced by `node:util.styleText` (colours only on a TTY stderr; the `stream` option needs Node >= 22.13, older 22.x always colours). `commander` and `superstruct` moved to `dependencies`; `electron` is now an optional peer. Follow-up: generated files start with a blank line before the notice (dedent leaves a leading newline).
