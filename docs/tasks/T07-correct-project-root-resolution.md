# T07: Correct project root resolution (monorepos)

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `resolveUserProjectPath` walks upward from the *library's install location* to the
  first `.git`. In monorepos and workspaces that is the repo root, not the Electron app package, so
  the wrong `package.json` config is read and output lands in the wrong place.
- **Scope:** resolve the project root as the nearest `package.json` upward from `process.cwd()`, and
  accept an explicit override (used by T37's `--cwd`). Keep `searchUpwards` caching correct when the
  cwd changes.
- **Tests:** unit tests for a nested workspace layout, plus an e2e test from a subpackage.
- **Delivered:** 2026-10-08. `resolveUserProjectPath(subPath, cwd = process.cwd())` finds the nearest `package.json` upward and throws if there is none (it used to fall back to `node_modules`); `ipcAutomation(cwd?)`, `getResolvedConfig(cwd?)` and `getConfigFromUserPackage(cwd?)` take the override as a parameter only, with no CLI flag (`--cwd` belongs to T38). `searchUpwards` keys now include a separator and misses are no longer cached. The e2e harness no longer mocks `resolveUserProjectPath`: it runs `ipcAutomation` from inside the fixture copy, and `runFixture` takes `{ project, cwd }`.
