# T125: Named imports instead of default export objects, and dead exports

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** Most modules export named functions and also a `default { ... }` object of the same
  functions. The object is only needed where a test spies on it (`logger`, `utils`, `cfg` in
  `src/config.ts`). Elsewhere it is redundant or mixed: `reserved-globals.ts` and `cache.ts` have
  no default importer, `parser/parser.ts` wraps one function, `scopes.ts` is imported both ways,
  and `writer/index.ts` is an aggregator object with one importer (`automation.ts`), a barrel in
  all but name. Some exports have no user outside their file: `DEFAULT_MAX_QUEUE` and
  `DEFAULT_HIGH_WATER_MARK` (`writer/base-writer.ts`), `hasTimeout`
  (`writer/preload/preload-invoke.ts`), and the interfaces `ReservedNameUses` and `SupportUses`.
- **Scope:** Drop the default objects of `reserved-globals`, `cache`, `parser` and `scopes` and
  import by name; let `automation.ts` import the writer classes from their modules and delete
  `writer/index.ts`; drop the dead `export` keywords. Keep the default objects of `logger`,
  `utils` and `config`, which the tests spy on.
- **Tests:** No behavior change: generated output byte-identical for every fixture, same test count,
  `bun run check` and `bunx vitest run` pass.
- **Delivered:** 2026-10-09. The default objects of `reserved-globals`, `cache`, `parser` and `scopes` are gone, `writer/index.ts` is deleted and `automation.ts` imports the writer classes by name. Tests import by name too; 3276 tests as before.
