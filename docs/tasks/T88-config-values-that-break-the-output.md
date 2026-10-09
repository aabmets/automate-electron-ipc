# T88: Config values which are accepted, but break the output

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the review of 2026-10-09.
  - The check of the output paths compares `utilityBindingsPath` and `serviceWorkerPreloadPath`
    only with `main.ts`, `preload.ts` and `window.d.ts`. A path that is the schema file, a file
    under `schema/`, or the serializer module is accepted, and the run overwrites the user's file.
  - Both paths accept a `.d.mts` or `.d.cts` file, which cannot hold the runtime code that is
    written into it (TS1046, TS1183).
  - `allowedOrigins` accepts an origin with the default port of its scheme, such as
    `http://localhost:80`. An origin never has one (`new URL("http://localhost:80").origin` is
    `http://localhost`), so the entry never matches and every call is rejected.
  - Unconfirmed: on a file system that ignores case, `ipc/Main.ts` passes the check and races with
    `main.ts`.
- **Scope:** refuse an output path that is a schema source or the serializer module, compared as
  resolved paths; refuse declaration files with the `/\.d\.[mc]?ts$/` rule of `isSchemaSourceFile`;
  refuse or normalize origins with a default port, the same in the schema options and the config.
- **Tests:** the `it.fails` of `T88` in `tests/test_e2e/generatorFindings.test.ts` turn into
  passing tests in the tests of the config and the validators.
- **Delivered:**
