# T172: A removed scope leaves its `types.<scope>.ts` behind

Phase 4: Developer experience. Found by [T48a](./T48a-readme-reference-and-example-harness.md) while
documenting the stale-file removal of [T43a](./T43a-generated-file-headers-and-stale-files.md).
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** when a scope is removed from the schema, the next run deletes `preload.<scope>.ts` and
  `window.<scope>.d.ts`, but not `types.<scope>.ts`. `scopedFilesNextTo` in `src/stale-files.ts` looks
  only next to `preloadBindingsFilePath` and `rendererTypesFilePath`, and `typesFilePath` is not among
  them. The old file stays, still imports the channel map, and then fails a type check that includes it
  (TS2536 on its indexed access of the map, since the scope's channels are gone). `--check` does not list it either.
- **Scope:**
  - Add the scoped files of `typesFilePath` to the candidates of `findStaleGeneratedFiles`. The usual
    rule holds: a file is removed only when its first line is the header of a generated file.
  - README: delete the note in "Stale files" and in "Scopes" that `types.<scope>.ts` must be deleted by
    hand, and add the file to the list of files that a run removes.
- **Tests:** e2e (temp dir): dropping a scope deletes `types.<scope>.ts` with the other two files, and a
  hand-written `types.foo.ts` without the header survives. `findStaleOutputs` lists it before the run.
- **Delivered:**
