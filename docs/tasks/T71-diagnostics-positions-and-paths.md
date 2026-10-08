# T71: Syntax error positions and the success report path

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the review of Phases 0 and 1.
  - `describeSyntaxError` reads the column from the miette code frame, which expands tabs and
    counts wide characters by display width: `\tconst b = ;` reports column 15 (the editor shows
    12) and `const s = "日本"; const b = ;` is off by two.
  - An error at the end of the input has no code frame, so the message names the file without
    line and column (`Syntax error in schema file '/p/schema.ts': Expression expected`), although
    T08 asked for `path:line:column`.
  - `logger.reportSuccess` shortens the path with `fullPath.indexOf(relativePath)`, which finds the
    first occurrence of the data dir name anywhere in the path. With `ipcDataDir: "ipc"` in a
    project under `automate-electron-ipc/`, it prints `ipc/<rest of the path>`.
- **Scope:** derive line and column from the span of the error (or fix up tabs and wide
  characters), give an end-of-input error the position of the end, and print the path relative to
  the project root.
- **Tests:** unit tests for a tab, a wide character, an error at the end of the input and a project
  path that contains the data dir name.
