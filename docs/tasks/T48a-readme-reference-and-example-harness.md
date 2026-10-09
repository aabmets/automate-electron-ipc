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
- **Delivered:**
