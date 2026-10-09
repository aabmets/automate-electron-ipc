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
- **Delivered:**
