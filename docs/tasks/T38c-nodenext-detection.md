# T38c: Detect NodeNext from `tsconfig.json`

Phase 4: Developer experience. Split from [T38](./T38-config-file-and-cli-flags.md).
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `projectUsesNodeNext` must be set by hand; it defaults to `false` (`src/config.ts`).
- **Scope:**
  - When `projectUsesNodeNext` is not set in any config source, read `<projectRoot>/tsconfig.json`
    only (not `tsconfig.*.json`: electron-vite projects have `tsconfig.node.json` and
    `tsconfig.web.json`, which is ambiguous). No `tsconfig.json` → `false`.
  - Parse it as JSONC without a new dependency: strip `//` and `/* */` comments (not inside
    strings) and trailing commas, then `JSON.parse`. `typescript` is not a runtime dependency.
  - Follow `extends` when it is a relative path (string or array; later entries win, the file
    itself wins over its bases). A package `extends` (e.g. `@tsconfig/node22`) is ignored.
  - NodeNext when `compilerOptions.module` or `compilerOptions.moduleResolution` is `node16` or
    `nodenext` (case-insensitive).
  - An explicit `projectUsesNodeNext` (any source) always wins.
  - Remove the default `projectUsesNodeNext: false` from the defaults in `getResolvedConfig`.
  - Put the reader in a new `src/tsconfig.ts`.
- **Test trap:** `typecheckProject` writes a `tsconfig.json` into the fixture's project root. A test
  that re-runs the generator after a type check would see detection flip. Run the generator before
  the type check, or set `projectUsesNodeNext` explicitly in such fixtures.
- **Tests:** `tests/test_config/nodeNext.test.ts`: no tsconfig; `module: "NodeNext"`;
  `moduleResolution: "node16"`; comments and trailing commas; relative `extends` (one level and two
  levels); package `extends` ignored; explicit `false` beats a NodeNext tsconfig; invalid JSONC →
  error naming the file.
- **README:** document the detection under `projectUsesNodeNext`.
- **Follow-up IDs:** T146-T147.
- **Delivered:** 2026-10-09. `detectNodeNext` in `src/tsconfig.ts` reads only `<projectRoot>/tsconfig.json`; `getResolvedConfig` calls it when no source or override sets `projectUsesNodeNext`, and the default `false` is gone. The JSONC reader is a small comment and trailing-comma stripper. A relative `extends` is followed per key (later entry wins, the file wins over its bases), a cycle is cut, and a relative base that does not exist is an error naming the file that extends it. No follow-ups, so T146-T147 stay free.
