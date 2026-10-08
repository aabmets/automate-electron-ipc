# T07: Correct project root resolution (monorepos)

Phase 1: Bug fixes.
Status and dependencies are in the [index](./README.md).

- **Problem:** `resolveUserProjectPath` walks upward from the *library's install location* to the
  first `.git`. In monorepos and workspaces that is the repo root, not the Electron app package, so
  the wrong `package.json` config is read and output lands in the wrong place.
- **Scope:** resolve the project root as the nearest `package.json` upward from `process.cwd()`, and
  accept an explicit override (used by T37's `--cwd`). Keep `searchUpwards` caching correct when the
  cwd changes.
- **Tests:** unit tests for a nested workspace layout, plus an e2e test from a subpackage.
- **Delivered:**
