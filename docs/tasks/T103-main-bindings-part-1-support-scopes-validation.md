# T103: Split `main-bindings.ts`, part 1: imports, support, scopes and validation

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:**
  - `src/writer/main-bindings.ts` is one class, `MainBindingsWriter`, of 3444 lines: the largest
    file by far, and the one that every feature task has grown. Four tasks (T103 to T106) split it,
    each leaving the output byte-identical. Line numbers below are those of the file when T102 was
    delivered.
  - This part sets the pattern for the other three. A TypeScript class body cannot span files, so
    the groups of `build*` methods move into modules that the writer calls.
- **Scope:**
  - Choose the composition pattern (see the skill) and write it down in the delivery note, because
    T104 to T106 follow it.
  - Move the first part: the import builders (`buildImports`, `importCustomTypes`,
    `addStreamImports`, `addTargetImports`, `addScopeImports`, `getImportedTypes`), `buildSupport`,
    the scope registry and target resolver (lines ~600 to 790), the error envelope and serializer
    helpers, and sender and argument validation (lines ~790 to 1057).
  - Keep the public surface of `MainBindingsWriter` as it is.
- **Tests:** No assertion changes. The generated output of every fixture in `tests/fixtures` is
  byte-identical before and after (dump it into the scratchpad first, then `diff -r`), the whole
  suite passes, and `bun scripts/check-size.ts --update` lowers the baseline in the same commit.
- **Delivered:** 2026-10-09. Pattern for T104 to T106: each feature group is a module of plain
  exported functions, shaped like `utility-runtime.ts`. A function takes what it reads from the writer
  as arguments: `indents` first, then the data, and `importsGenerator` where it imports. There are no
  new classes and no pass-through wrapper methods. The new modules are `main-imports.ts`,
  `main-registries.ts` (scope registry, target resolver), `main-validation.ts` and
  `main-support.ts`. `buildSupport` takes a `SupportBuilders` object of callbacks for the groups
  that are still methods. Each later part replaces its callbacks with direct calls, and T106
  removes the interface. `main-bindings.ts` went from 3444 to 2913 lines, and the output of all 95
  fixtures is byte-identical.
