# T43: Generated file hygiene

Phase 4: Developer experience.
Status and dependencies are in the [roadmap](../roadmap.md).

> **Split** (architect review, 2026-10-09) into the parts listed in the roadmap. Each part's file is
> the plan to build from; this file keeps the original scope for reference.

- **Scope:**
  - The notice header names `ipcgen` and the schema path.
  - Add `/* eslint-disable */` and a Biome ignore directive.
  - Optional config `format: "biome" | "prettier" | false` runs the user's formatter if installed.
  - Generated code passes the repo's own Biome rules.
  - Found in T29: remove a stale generated file that the schema no longer needs. `utility.ts` is
    written only when the schema has a channel to a utility process, so a file from an earlier run is
    left behind when the last such channel is removed.
  - Found in T33: the same for `preload.<scope>.ts` and `window.<scope>.d.ts` of a scope that the
    schema no longer lists.
  - Found in T36: the same for `service-worker-preload.ts` and `service-worker.d.ts`, which are written
    only when the schema has a channel to or from a service worker.
- **Tests:** writer tests; e2e runs Biome on the output.
- **Delivered:**
