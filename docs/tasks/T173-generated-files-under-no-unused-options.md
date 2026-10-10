# T173: Generated `main.ts` and `utility.ts` fail `noUnusedLocals` and `noUnusedParameters`

Phase 4: Developer experience. Found by [T48a](./T48a-readme-reference-and-example-harness.md) while
checking the "TypeScript configuration" section of the README against the electron-vite template.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** the base config of the electron-vite template (`@electron-toolkit/tsconfig`) sets
  `noUnusedLocals`, `noUnusedParameters` and `noImplicitReturns`. Compiling the generated files with those
  options (and the rest of that base config) reports errors in `main.ts` and `utility.ts`: helpers that the
  schema does not use (`sendUtilityPeer`, `setUtilityHandler`, `addUtilityListener`, `callUtilityChild`,
  `callUtilityPeer`, `closeUtilityPeer`) and the type import `MessagePortMain` (TS6133 and TS6196). The Vite build
  does not type-check, so the build works, but `tsc` on `tsconfig.node.json` (the `typecheck:node` script of
  the template) fails. `preload.ts`, `window.d.ts`, `types.ts`, `mock.ts` and the hooks are clean.
  The all-fixtures lint test (T43a) suppresses unused helpers in the header; the type check has no such switch.
- **Scope:**
  - Make the generated code free of unused locals and parameters: emit a helper and its imports only when
    a channel uses them, or reference them in a way TypeScript counts (and keep the other generated
    files clean, under `noImplicitReturns` too).
  - A new e2e test compiles the output of every fixture (all the `extraGeneratedFiles` outputs) with
    `noUnusedLocals`, `noUnusedParameters` and `noImplicitReturns` on, and expects no diagnostics.
  - README: delete the note in "TypeScript configuration" that these options must be off.
- **Tests:** the e2e test above, run against the fixtures of the electron-vite layout (`mock`,
  `electron-utility`, `electron-scopes`, `electron-service-worker`) at least.
- **Delivered:** 2026-10-10. A new step of `BaseWriter.render` (`src/writer/prune-helpers.ts`) removes the shared
  helpers that nothing in the file calls: the parts of the utility peer (`callUtilityPeer`,
  `sendUtilityPeer`, `setUtilityHandler`, `addUtilityListener`, `closeUtilityPeer`, `callUtilityChild`,
  `lastUtilityCallId`), the broker registrations, the serializer helpers, and `IpcEnvelope`. It repeats until
  nothing more goes, and drops the names of the serializer import that no helper uses. The list of names is
  explicit, so no other declaration is touched. Also fixed: `main.ts` imported `MessagePortMain` for
  `stream` channels without using it, and `types.ts` imported the error classes that only a `@throws` tag
  names (it keeps the tag, and no longer imports them; `window.d.ts` is a declaration file and is unchanged).
  Found beyond the task: `preload.ts` and `service-worker-preload.ts` had unused serializer helpers and
  `IpcEnvelope` too, the same step covers them. New e2e test `unusedOptions.test.ts` type-checks every
  fixture with `noUnusedLocals`, `noUnusedParameters` and `noImplicitReturns` (`directory-packages`,
  `export-equals` and `import-equals-require` are skipped, since their imports need options of their own,
  unrelated to unused code). The two README notes are gone.
