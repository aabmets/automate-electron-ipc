# T127: Extract the channel collection of `MainBindingsWriter`, and an `anySpec` helper

Phase 3b: Module structure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `MainBindingsWriter.renderFileContents` (`src/writer/main/main-bindings.ts`,
  about 130 lines, in a file of 288, over the soft limit) keeps ten mutable accumulators, branches
  four ways per direction inside nested loops, then builds the `buildSupport` argument.
  `pfsArray.some((pfs) => pfs.specs.channelSpecArray.some(...))` is written nine times
  (`channel-kinds.ts`, `base-writer.ts`, `main-bindings.ts`, `main-registries.ts`,
  `preload-invoke.ts`, `utility-bindings.ts`).
- **Scope:** Add `anySpec(pfsArray, predicate)` and `allSpecs(pfsArray)` to
  `writer/channel-kinds.ts` and use them. Move the collection into a new
  `writer/main/main-collect.ts` that returns the channels, the feature flags, the imports and the
  event types, with `hasChannels`, `hasPorts` and `usesEventWatch`; `renderFileContents` only
  assembles.
- **Tests:** Generated output byte-identical; same test count; `main-bindings.ts` under 280 lines.
- **Delivered:**
