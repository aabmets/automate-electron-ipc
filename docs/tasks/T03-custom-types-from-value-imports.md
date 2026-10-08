# T03: Custom types from value imports are dropped (B3)

Phase 1: Bug fixes.
Status and dependencies are in the [index](./README.md).

- **Problem:** only `import type` / `import { type X }` are recorded. `import { Settings } from "..."`
  used in a signature makes the generated files reference `Settings` without importing it.
- **Scope:** record every named or default import whose local name appears in a channel signature's
  type positions, and emit it as `import type` in the generated files. Also handle default imports
  (`import Foo from`) correctly.
- **Tests:** parser unit tests, plus an e2e test where the output type-checks.
- **Delivered:**
