# T44: Exported helper types

Phase 4: Developer experience.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** users cannot type wrappers or hooks generically.
- **Decisions (from the architect review; the original "Decision needed" is settled with these
  defaults):**
  - `ChannelResult` is already a public type (`types/channel-base.d.ts:34`), so the result helper
    is named `ChannelReturn`. The new names are `IpcApi`, `ChannelName`, `ChannelArgs<N>` and
    `ChannelReturn<N>`.
  - `IpcApi` is the existing emitted interface, moved: the `interface IpcApi` that
    `src/writer/renderer/renderer-declaration.ts` emits into `window.d.ts` today is emitted into
    the new `types.ts` as `export interface IpcApi`, and `window.d.ts` imports it with
    `import type { IpcApi } from "./types"` (spelled through `ImportPathResolver`, so NodeNext gets
    `./types.js`). Do not try to rebuild it with mapped types: it has per-kind methods, doc
    comments, `rawErrors`, timeouts and scope variants.
  - Scopes: `types.ts` holds the default-scope surface. Each scope gets `types.<scope>.ts` via
    `scopedFilePath`, which `window.<scope>.d.ts` imports.
  - `types.ts` is always written (one more file in every run).
  - The channel helpers cover the page-facing channels only (the channels of `IpcApi`), not
    utility process or service worker channels.
- **Scope:**
  - `ChannelName`, `ChannelArgs<N>`, `ChannelReturn<N>` are derived with mapped types over
    `typeof` the exported channel maps from T00 (`import type`, using `specs.channelMapExport`,
    `types/internal-specs.d.ts:14`), as the original plan asks, as a union across schema files:
    ```ts
    type Sig<T> = T extends ChannelDef<infer S, any> ? S : T extends (...a: any) => any ? T : never;
    ```
    Check how both declaration forms (verb call and `as` form, see T00) appear in `typeof` and
    adjust the extraction. `ChannelReturn<N>` is `Awaited<ReturnType<Sig<…>>>`; for streams it is
    the chunk type of the `AsyncIterable`.
  - New writer `src/writer/renderer/helper-types.ts` (a `BaseWriter` subclass), registered as one
    new entry in the output list of T139. Add `typesFilePath` to `OutputPaths`
    (`src/config-outputs.ts`), `IPCResolvedConfig`, `assertOutputsDistinct`, and the config mock in
    `tests/utils/automation-utils.ts`.
  - Add `types.ts` to the typecheck file list from T139 (`tests/utils/e2e/typecheck-project.ts`).
  - Update the file-listing assertions (`readdir`) in `ipcAutomation.files.test.ts` and
    `scopes.files.test.ts`.
- **Tests:** writer text tests in `tests/test_writer/renderer/helper-types.test.ts`; an e2e
  type-level file with `expectTypeOf` per channel kind (invoke, send, emit, stream, ask, port) and
  both declaration forms, plus a main-process file that imports `types.ts` without getting the
  renderer's global `ipc` declared (a `// @ts-expect-error` on `window.ipc` there).
- **README:** a "Helper types" section.
- **Follow-up IDs:** T164-T165.
- **Delivered:**
