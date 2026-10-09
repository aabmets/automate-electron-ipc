# T128: Duplication in config resolution and validation

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** In `src/validation/config-validation.ts` the refiners of `utilityBindingsPath` and
  `serviceWorkerPreloadPath` are the same apart from the option name. `getResolvedConfig`
  (`src/config.ts`) is 80 lines that derive the output paths, check them for clashes and build
  the result in one body.
- **Scope:** One parametrised refiner; extract `deriveOutputPaths` and `assertOutputsDistinct`
  from `getResolvedConfig`, using `toPosix` of T126. Error messages stay word for word.
- **Tests:** Same test count, no assertion changed; `bun run check` and `bunx vitest run` pass.
- **Delivered:**
