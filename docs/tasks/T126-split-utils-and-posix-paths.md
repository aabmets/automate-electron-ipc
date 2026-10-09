# T126: Split `src/utils.ts`, and one helper for posix paths

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `src/utils.ts` mixes paths (`searchUpwards`, `resolveUserProjectPath`,
  `isPathInside`, `isSchemaSourceFile`), the file system (`isCaseInsensitiveFileSystem`), text
  (`dedent`, `concatRegex`) and sorting (`compareStrings`). `concatRegex` has no user in `src/`,
  and `dedent` has one (a constant notice in `writer/base-writer.ts`). The backslash-to-slash
  conversion is written out 14 times (`config.ts` 7, `automation.ts` 3, `validation/global-validation.ts`,
  `logger.ts`, `utils.ts`, `writer/import-paths.ts`), and `automation.ts` and
  `global-validation.ts` repeat the same normalize-then-compare sort.
- **Scope:** Add `toPosix(path)` and `comparePaths(a, b)` and use them at those sites. Move
  `concatRegex` and `dedent` to `tests/utils/` (the notice becomes a plain constant). Split the
  rest by concern if a module of more than 30 lines results (see the `module-structure` skill);
  keep the default object that the tests spy on.
- **Tests:** Unit tests for `toPosix` and `comparePaths`; generated output byte-identical; same
  test count apart from the new tests.
- **Delivered:**
