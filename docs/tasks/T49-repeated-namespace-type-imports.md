# T49: Repeated use of a namespace import generates a bogus import

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found during T03. `ImportsGenerator.getDeclaration` handles `NS.A` correctly with
  `import type * as NS from "./t"`. A second signature type from the same namespace, `NS.B`, takes
  the named-import branch and generates `import type { B } from "./t"`, which does not match any
  import in the schema file and fails to type-check.
- **Scope:** a namespace that was already imported yields no further declaration. Do not touch
  named-import handling.
- **Tests:** an `ImportsGenerator` unit test with two types from one namespace, plus an e2e
  fixture where the output type-checks.
- **Delivered:**
