# T42b: Report multiple schema errors together

Phase 4: Developer experience. Split from [T42](./T42-diagnostics.md).
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** the first schema error stops the run; a user fixes errors one at a time.
- **Scope:**
  - New `SchemaErrors extends Error` in `src/parser/diagnostics.ts` (or a new module if that file
    nears 280 lines) holding `errors: SchemaError[]`, sorted by file, then line, then column. Its
    `message` joins the messages with a blank line, and ends with `N errors` when there is more
    than one. At most 20 are kept; the rest are counted (`and 7 more errors`).
  - Collect per channel inside `parseChannelMapModule`: an error in one channel's options or
    signature does not stop the others. Errors that make the whole file unreadable (syntax error,
    missing channel map) still stop that file.
  - Collect across files in the schema source loop of `planRun` (T139): parse every file, then
    throw one `SchemaErrors` if any failed, before global validation. Global validation runs only
    when every file parsed.
  - A single error is thrown as the plain `SchemaError` (the message does not change).
  - `logger.fatalError` prints a `SchemaErrors` message as is.
- **Tests:** `tests/test_parser/diagnostics/multipleErrors.test.ts`: two bad channels in one file
  → both reported, in order; errors in two files → both; 25 errors → 20 plus `and 5 more errors`;
  a syntax error in one file and a bad channel in another → both; one error → unchanged message.
  Exact-string assertions.
- **Follow-up IDs:** T158-T159.
- **Delivered:**
