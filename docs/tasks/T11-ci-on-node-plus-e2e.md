# T11: CI on Node, plus e2e type-check job

Phase 1: Bug fixes.
Status and dependencies are in the [index](./README.md).

- **Problem:** CI runs vitest under Bun only, which is how B1 shipped.
- **Scope:**
  - Add a Node 22/24 matrix to `.github/workflows/vitest-codecov.yaml`.
  - Run the e2e suite (including the type-check of generated output) in CI.
  - Run `bun run check` in CI.
- **Tests:** the workflow itself; verify locally with `node`.
- **Delivered:**
