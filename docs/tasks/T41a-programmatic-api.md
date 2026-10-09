# T41a: Programmatic API (`automate-electron-ipc/api`)

Phase 4: Developer experience. Split from
[T41](./T41-programmatic-api-and-vite-electron.md).
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** there is no programmatic entry; `src/index.ts` exports only the schema DSL.
- **Decisions (from the architect review):**
  - The API is silent by default and never sets `process.exitCode`; it throws on errors.
  - `logger?: boolean` option: `true` prints the same lines as the CLI.
- **Scope:**
  - New `src/api.ts`:
    ```ts
    export interface GenerateOptions extends RunOptions { logger?: boolean }
    export interface GenerateResult { files: string[]; channels: number }
    export async function generate(options?: GenerateOptions): Promise<GenerateResult>;
    export async function check(options?: GenerateOptions): Promise<{ stale: string[] }>;
    ```
    `generate` uses `planRun` + `writeOutputs` (T139): `files` are the written absolute posix paths,
    sorted; `channels` the number of channel specs. A missing schema throws an `Error` with the
    message of `logger.nonExistentSchemaPath` (and, unlike the CLI, does not create the directory).
    `check` uses `findStaleOutputs` (T39); a missing schema throws the same error.
  - `logger.ts` writes to `console` directly. Add a module-level switch (e.g.
    `logger.setSilent(boolean)` restored in a `finally`) rather than threading a logger through
    every call.
  - Public types: the package's types are hand-written `.d.ts`, not emitted. Add `types/api.d.ts`
    with the declarations above (spell `RunOptions` out there as a public `ApiRunOptions`, with
    `configFile` and `overrides: AutoIpcConfig` from T38a). Biome allows `export *` only in
    `index.d.ts`/`internal.d.ts`, so `api.d.ts` declares its exports directly.
  - `package.json` `exports` becomes:
    ```json
    {
       ".": { "types": "./types/index.d.ts", "default": "./dist/index.js" },
       "./api": { "types": "./types/api.d.ts", "default": "./dist/api.js" }
    }
    ```
    T41b adds `./vite` the same way.
- **Tests:**
  - `tests/test_api/generate.test.ts`: writes the files and returns them; `channels` count; missing
    schema throws and creates nothing; silent by default (spy on `console`), prints with
    `logger: true`; overrides reach the config.
  - `tests/test_api/check.test.ts`: fresh → `[]`; stale → paths.
  - `tests/packaging.test.ts`: every `exports` target's `types` file exists, and every `default`
    maps to a `src/` file that `tsc` emits to that path.
  - A type-level test that `import { generate } from "automate-electron-ipc/api"` resolves with the
    declared types (follow how `tests/test_types/` checks the public types).
- **README:** an "API" section.
- **Follow-up IDs:** T152-T153.
- **Delivered:** 2026-10-09. `generate` and `check` in `src/api.ts` (silent by default through `logger.setSilent`, restored in a `finally`), types in `types/api.d.ts`, `exports` map with `.` and `./api`. `ApiRunOptions` and `GenerateOptions` are public; the internal `RunOptions` is unchanged. No follow-ups, so T152-T153 are unused.
