# T42a: Error positions and code frames

Phase 4: Developer experience. Split from [T42](./T42-diagnostics.md).
Status and dependencies are in the [roadmap](../roadmap.md).

- **Scope correction (architect review):** unknown channel option keys are already errors
  (`src/parser/channel/channel-options.ts:194`), and raw config `StructError`s move to T38a. The
  superstruct structs in `src/validation/channel-spec-structs.ts` only guard specs that did not come
  from the parser, so they are not reformatted.
- **Decisions:**
  - Message format: keep the `Schema file '<file>'` prefix (21 test assertions in 13 files match on
    it) and add the position after it: `Schema file '<file>' (3:5): <message>`, followed by a code
    frame. Without a known position the message stays as it is today.
  - Line and column are 1-based; the column counts UTF-16 code units, as editors do.
- **Scope:**
  - `SchemaError` (`src/parser/diagnostics.ts:16`) takes an optional `span` (swc `Span`, byte
    offsets) and the source it belongs to.
  - `parseModule`'s `Source` (`src/parser/ast.ts`) gets `position(span): { line; column }`. swc
    spans are UTF-8 byte offsets and relative to the module's start offset; keep the BOM handling
    in `ast.ts` in mind and add a test for a file with a BOM and one with non-ASCII text before
    the error.
  - The code frame is the error line plus one line before and after, with a gutter of line numbers
    and a caret line under the span start (`^`, extended with `~` to the span's end on the same
    line). Reuse `expandTabs`/`displayWidth` in `diagnostics.ts` so tabs and wide characters line up.
  - Pass the node span at every `new SchemaError(...)` and `fail(...)` call site under
    `src/parser/**` (about 32; `fail` is built in `src/parser/channel/channel-map.ts`).
  - Errors from `src/validation/channel-validation.ts` and `global-validation.ts` (e.g. a duplicate
    channel across files) have no span because `ChannelSpec` has none. Add
    `loc?: { line: number; column: number }` to `ChannelSpec` (`types/internal-channels.d.ts`),
    fill it in the parser from the channel key's span, and use it in those messages (position
    only; no frame, since the source text is not at hand there).
- **Tests:** exact-string assertions (the repo has no snapshots; use `toBe`, or
  `toMatchInlineSnapshot` if it reads better) in `tests/test_parser/diagnostics/positions.test.ts`
  for: an unknown verb; an unsupported option; a non-function signature; a bad `validate`
  reference; a duplicate channel across two files (position, no frame); a line with tabs and a wide
  character before the error; a BOM file; an error on line 1 (no line before). Existing
  assertions keep passing, or are updated in the same commit if they matched the whole message.
- **Follow-up IDs:** T156-T157.
- **Delivered:** 2026-10-09. `Source` got `position` and `frame`; `SchemaError` takes an `ErrorSite`
  (span and source). Every parser call site passes a node span, and a property of an object literal
  has none, so `nodeSpan` derives it. `ChannelSpec.loc` is the position of the channel key (the spec
  structs accept it), used by the reserved-name, `maxQueue`, `timeoutMs`, clone and duplicate-channel
  messages. The `parseError` test helper strips the position and frame; `parseFullError` keeps them.
