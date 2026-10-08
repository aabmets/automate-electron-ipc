# T11: CI on Node, plus e2e type-check job

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** CI runs vitest under Bun only, which is how B1 shipped.
- **Scope:**
  - Add a Node 22/24 matrix to `.github/workflows/vitest-codecov.yaml`.
  - Run the e2e suite (including the type-check of generated output) in CI.
  - Run `bun run check` in CI.
- **Tests:** the workflow itself; verify locally with `node`.
- **Delivered:** 2026-10-08. Extended the existing workflow with `check` (bun run check), a `test` matrix (Node 22, Node 24, Bun via `bun --bun`) and a dedicated `e2e` job (Node 22/24). Coverage upload now runs from the Node 24 leg only. Deviation: added `push` (main) and `pull_request` triggers, since the file only had manual and `workflow_call` triggers and nothing called it. Validated with actionlint; ran the job commands locally under Node 22 and Bun (Node 24 not available here). Follow-up: `bunx vitest run` already hands over to Node via the vitest shebang, so the earlier Bun-only premise was partly wrong.
