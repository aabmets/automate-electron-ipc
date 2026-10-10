# T48a: README reference sections and the README example check

Phase 4: Developer experience. Split from [T48](./T48-readme-rewrite.md).
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** the README (about 1500 lines) grew one feature section at a time. A full rewrite in
  one commit is not reviewable, so T48 is split by section: T48a (this), then T48b, T48c and T48d
  in parallel.
- **Scope:**
  - The README example check, which T48b-T48d reuse:
    - A fenced ` ```ts ` block directly preceded by `<!-- readme-example: <name> <file> -->` is an
      example. Blocks with the same `<name>` form one fixture project; `<file>` is the path inside
      it (e.g. `src/autoipc/schema.ts`, `src/main.ts`).
    - New `tests/test_e2e/automation/readmeExamples.test.ts`: extract every example from
      `README.md` with a regex, write each fixture project to a temp dir (with a generated
      `package.json` and the e2e harness defaults), run the generator, and type-check it with
      `typecheckProject`. Register temp dirs with the fixture tracker (`fixtures.run`).
    - Fails when a named example does not generate or type-check; the message names the example.
  - Rewrite and reorder the reference part of the README (sections "Installation" to "Getting
    Started", currently lines 40-165, plus the feature sections that T38a-T47b appended):
    1. Installation.
    2. Configuration reference: every key of `AutoIpcConfig` in one table (name, type, default,
       description), the config file forms and precedence (T38a), the NodeNext detection (T38c).
    3. CLI reference: `ipcgen` with every flag (`--cwd`, `--config`, `--out-*`, `--check`,
       `--watch`), with a CI example for `--check`.
    4. Programmatic API (`/api`) and the Vite plugin (`/vite`) reference (T41a, T41b).
    5. tsconfig wiring: what the generated files need (`include`, `module`/`moduleResolution`,
       NodeNext import extensions), for a plain Electron project and for electron-vite's split
       tsconfigs.
    6. Generated files: one table of every output (main, preload, window, types, mock, hooks,
       utility, service worker, scoped files), when each is written, and stale-file removal (T43a).
  - Tag at least the "Getting Started" and "Simple Example" code as a `readme-example`.
  - Check every claim against the code; fix stale ones (e.g. a T93 note said utility-call
    timeouts were missing; T99 added them).
- **Tests:** the README example check above, passing on the tagged examples.
- **Follow-up IDs:** T172-T173.
- **Delivered:** 2026-10-10. The README example check is `tests/test_e2e/automation/readmeExamples.test.ts`,
  with the extractor in `tests/utils/e2e/readme-examples.ts`. A block is an example when the line above it
  is `<!-- readme-example: <name> <file> -->` and it is a `ts`, `typescript` or `json` block; the blocks of
  one name are written into a copy of `tests/fixtures/readme-project` (new `files` option of
  `runFixture`), generated, and type-checked: the schema and the generated files with `typecheck`, and the
  other `.ts` files of the example with `typecheckFiles`, together with `window.d.ts` for the global
  `ipc`. A failure names the example. A test also fails when a tag has no matching block. "Getting
  Started" (`getting-started`) and "Simple Example" (`simple-example`) are tagged.
  The reference part of the README is now: Installation, Configuration (one table of every key, the config
  file and its precedence, NodeNext), Command line (every flag, `--check`, `--watch`), API, Vite,
  TypeScript configuration (which file goes to which project, plain Electron and electron-vite), and
  Generated files (one table, headers, stale files). Claims were checked against the code; the stale ones
  fixed: `codeIndent` is limited to 2 to 4, `projectUsesNodeNext`, `isolatedWorldId` and `serializer` had
  no entry in the defaults, and the Scopes section said that a removed scope leaves all its files behind
  (the next run deletes two of the three). Found, not fixed: a removed scope leaves `types.<scope>.ts`
  behind (T172), and the generated `main.ts` and `utility.ts` fail `noUnusedLocals` and
  `noUnusedParameters`, which the electron-vite template turns on (T173). The README notes both until
  they are fixed. The utility-call timeouts that the T93 note called missing were already documented
  by T99.
