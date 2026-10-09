# T101: Directory imports through `package.json` and path mappings

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found while delivering T97, which resolves a relative directory import such as
  `./models` to `./models/index.js` under NodeNext when the directory has an index file. A directory
  whose entry point comes from its own `package.json` (`main`, `types` or `exports`), and an alias
  such as `@/models` that `paths` of the tsconfig maps to a directory, are still copied as they are,
  which NodeNext does not resolve. Low priority: the common case is an `index.ts`.
- **Scope:** decide whether to resolve these forms to the file they stand for, or to report them
  with a clear error under NodeNext. Keep the T97 rule that a sibling file wins over a directory.
- **Tests:** e2e fixtures under NodeNext that assert on the generated text and type-check it.
- **Delivered:** 2026-10-09. Neither resolved to a file nor reported: a relative directory whose
  `package.json` has `types`, `typings`, `typesVersions` or `main` is kept as the directory, with no
  `.js`. A schema file can import a directory only in a CommonJS module under NodeNext (checked
  with tsc: in an ES module it fails in the schema file itself), and there the generated files
  resolve the same specifier the same way, the types through `types` and the code through `main`,
  which no one file path spells when they differ. Before, `./models` became `./models.js`, or
  `./models/index.js` when an index file existed, although the `package.json` comes first. A
  `package.json` with only `exports` (which does not apply to a relative specifier) or none of these
  fields still names the index file, and a sibling file still wins (T97). Path mappings needed no
  code: an alias is copied as it is and resolves in the generated files as in the schema file, so
  the premise above was wrong for them; the fixture `directory-packages` pins both. Not covered: a
  `.cts` schema file in an ES module project, whose generated files cannot import the directory.
