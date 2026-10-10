# Docs migration plan: README.md to docs/ (GitHub Pages)

Planning document only. It is deleted together with `docs/tasks` and `docs/roadmap.md` when the migration is finished.

## 0. Rules for every worker

- You own only the files listed for your package (section 3). Never write any other file. Need a change in someone else's file? Put it in your final report; do not make it.
- **Verify before writing.** For every claim you move (option names, defaults, error messages, generated names, behavior), check it against the source areas listed for your package. If the README is wrong or stale, write what the code does and list the discrepancy in your final report. If the README omits behavior you find in your source areas, document it.
- Move the content faithfully; you may restructure and tighten for readability, but do not drop information. Keep the existing tagged examples (section 4) and their tags.
- Do not cite `docs/tasks/*` or `docs/roadmap.md` in the docs, and do not link to them.
- Links between pages: use site-relative Markdown links with the `.md` extension that work both on GitHub and in Jekyll, for example `[Timeouts](../channels/invoke.md#timeouts)`. Every README anchor link (`](#...)`, 72 of them) must be rewritten to the new page's relative path. Where the target page belongs to another package, use the target path from section 1 plus a heading anchor; the final pass checks the anchors.
- Liquid: Jekyll (GitHub Pages) evaluates `{{ }}` and `{% %}` outside raw tags, even inside code fences. If a page contains either sequence, wrap the fence in `{% raw %}` ... `{% endraw %}` lines. Known case: README line 2564 (Vue hooks, package P6).
- Front matter on every page follows section 1. Page titles: sentence case, short.
- Use 3-space indentation in code samples, like the README.
- Commit only your own files, `git pull --rebase origin claude/lucid-sagan-35t6kr` before pushing, push to `claude/lucid-sagan-35t6kr`. Do not touch `README.md`, the test, or `CLAUDE.md` unless your package owns it.

## 1. Target tree and site conventions

Theme: **just-the-docs as a remote theme**, minimal Jekyll, built by GitHub Pages from `/docs` on the branch (Settings, Pages, Deploy from branch, folder `/docs`). Reason: it gives a sidebar tree, search and nav ordering from front matter alone, with no build step or Gemfile in the repo. `docs/tasks` and `docs/roadmap.md` are excluded in `_config.yml` so they never publish while they still exist.

Front matter convention:

```yaml
---
title: Invoke channels
parent: Channels        # the title of the section index page; omit on section index pages and on top-level pages
nav_order: 2            # order inside the parent (1-based, set by the page's owner)
---
```

Section index pages (`<dir>/index.md`) use `has_children: true`, `nav_order: N` (top-level order from the tree below) and no `parent`. They contain a short intro and a list of the pages of the section. Each page starts with `# Title` after the front matter and a one-paragraph summary. The first `# H1` is the page title, so `## ` is the top heading inside a page (demote README headings accordingly).

```
docs/
  _config.yml                          P1  remote_theme: just-the-docs/just-the-docs, title, search_enabled, exclude: [tasks, roadmap.md, README.md]
  index.md                             P1  landing page, nav_order 1: description, feature list, map of the docs
  getting-started/                     P1  nav_order 2
    index.md                           P1
    installation.md                    P1
    quickstart.md                      P1  (Getting Started, README 683-756; tags getting-started)
    simple-example.md                  P1  (README 784-825; tags simple-example)
    channel-maps.md                    P1  (README 757-783)
  tooling/                             P2  nav_order 3
    index.md
    configuration.md                   (68-207: options table, config file, NodeNext)
    command-line.md                    (208-263: CLI, --check, watch mode)
    node-api.md                        (264-293)
    vite.md                            (294-320 plus the bundler parts of 455-549 that are about Vite)
    typescript-configuration.md        (321-407)
    generated-files.md                 (408-454: headers, stale files)
    preload-bundling.md                (455-549: sandbox, preload composition; tags preload-compose)
    electron-vite.md                   (550-682; tags electron-vite)
  schema/                              P3  nav_order 4
    index.md
    verbs.md                           (826-944; tags verbs)
    generated-api.md                   (945-973)
    what-can-be-sent.md                (3165-3184)
    custom-serializers.md              (3185-3285)
    as-form.md                         (3286-3308)
  channels/                            P4  nav_order 5
    index.md
    invoke.md                          (974-1211: invoke, Errors, Timeouts)
    send.md                            (1212-1340: send, handlers for one window)
    emit.md                            (1341-1469: emit, targets)
    ask.md                             (1470-1593)
    stream.md                          (1594-1772: stream, backpressure)
  processes/                           P5  nav_order 6
    index.md
    ports.md                           (1773-1935: port, mainPort)
    send-queues.md                     (1936-2011)
    utility-processes.md               (2012-2148)
    utility-from-renderer.md           (2149-2284)
    service-workers.md                 (2285-2467)
  renderer/                            P6  nav_order 7
    index.md
    helper-types.md                    (2468-2502)
    framework-hooks.md                 (2503-2578: React, Vue)
    mocking.md                         (2579-2630)
  security/                            P7  nav_order 8
    index.md
    threat-model.md                    (2631-2682: intro, threat model, default checks)
    sender-validation.md               (2683-2719)
    validating-arguments.md            (2720-2751)
    scopes.md                          (2752-2809)
    putting-it-together.md             (2810-2922)
    checklist.md                       (2923-2939)
  migration/                           P6  nav_order 9
    index.md                           (2940-3164 split: overview and the list below)
    schema-rewrite.md                  (2956-3058: rewriting the schema, generated names)
    config-and-behavior.md             (3059-3164: config and CLI, generated files, behavior, package and Node version)
  contributing/                        P1  nav_order 10
    index.md                           (Development, 3309-3332)
```

Where a package finds that a split page would be under about 40 lines or over about 600, it may merge or split its own pages, keeping the section directory and its `index.md` list consistent. It must tell the final pass in its report.

## 2. Packages (disjoint ownership)

| Pkg | README lines | Owns (writes) |
|---|---|---|
| P1 Site, landing, getting started | 1-67, 683-825, 3309-3332 | `docs/_config.yml`, `docs/index.md`, `docs/getting-started/*`, `docs/contributing/*`, **the README rewrite**, **the test change** (section 4), the `package.json` `files` check |
| P2 Tooling | 68-682 | `docs/tooling/*` |
| P3 Schema | 826-973, 3165-3308 | `docs/schema/*` |
| P4 Channels | 974-1772 | `docs/channels/*` |
| P5 Processes | 1773-2467 | `docs/processes/*` |
| P6 Renderer and migration | 2468-2630, 2940-3164 | `docs/renderer/*`, `docs/migration/*` |
| P7 Security | 2631-2939 | `docs/security/*` |

P1 is the only package that edits `README.md`. It must not shrink the README until all other packages have pushed (the other workers read their line ranges from the original README, on the commit this plan sits on; `git show <this-commit>:README.md` always works). So P1 runs in two steps: write its docs first, and do the README rewrite and the test change as the last step, after the other six have reported. The coordinator dispatches P2-P7 first (in parallel), then the P1 finish.

New README (P1): badges, `# Automate Electron IPC`, Description, Features list, Installation (short), a Quickstart (the minimal schema, one main handler, one renderer call; at most about 60 lines; no tags, to avoid duplicate example names, or tags under names with a `readme-` prefix that are not in the docs), a prominent link to the GitHub Pages site (`https://aabmets.github.io/automate-electron-ipc/`) and to the `docs/` folder, License line. `tests/packaging.test.ts:105` reads the README: keep it passing.

## 3. Source areas each worker must read to verify claims

All paths under `src/` unless noted. Always also read `src/index.ts` and `types/` for the public surface.

- **P1**: `package.json` (engines, peer deps, scripts, bin), `src/cli.ts`, `src/cli-options.ts`, `src/index.ts`, `src/automation.ts`; for the examples `tests/utils/e2e/readme-examples.ts`; for Development `package.json` scripts, `tests/test_electron/`, `.github/workflows/vitest-codecov.yaml`.
- **P2**: `config.ts`, `config-file.ts`, `config-outputs.ts`, `cli.ts`, `cli-options.ts`, `api.ts`, `vite.ts`, `watch.ts`, `check.ts`, `tsconfig.ts`, `output-files.ts`, `stale-files.ts`, `schema-sources.ts`, `file-system.ts`, `formatter.ts`, `cache.ts`, `validation/config-validation.ts`, `validation/option-structs.ts`, `writer/preload/preload-bindings.ts` (bundling and sandbox facts), `writer/import-paths.ts`.
- **P3**: `parser/channel/*`, `parser/type/*`, `parser/ast.ts`, `parser/parser.ts`, `parser/schema-errors.ts`, `validation/channel-spec-structs.ts`, `validation/channel-validation.ts`, `validation/global-validation.ts`, `validation/clone-issues.ts`, `validation/reserved-globals.ts`, `writer/channel-kinds.ts`, `writer/param-names.ts`, `writer/rename-signatures.ts`, `types/`.
- **P4**: `writer/main/main-senders.ts`, `main-listeners.ts`, `main-asks.ts`, `main-streams.ts`, `main-bindings.ts`, `main-renderer-channels.ts`, `main-registries.ts`, `main-support.ts`, `main-watches.ts`; `writer/preload/preload-invoke.ts`, `preload-subscriptions.ts`, `preload-asks.ts`, `preload-streams.ts`; `writer/generated-errors.ts`, `writer/renderer/renderer-declaration.ts`, `renderer-types.ts`; `validation/browser-window-events.ts`; behavior tests in `tests/test_electron/channels/` and `tests/test_e2e/` for edge cases.
- **P5**: `writer/main/main-ports.ts`, `main-port-helpers.ts`, `main-utility.ts`, `main-workers.ts`, `main-worker-*.ts`, `main-off-page.ts`; `writer/preload/preload-ports.ts`, `preload-port-queue.ts`, `preload-utility*.ts`, `service-worker-preload.ts`; `writer/utility/*`; `writer/renderer/service-worker-types.ts`; `scopes.ts`; tests under `tests/test_electron/` and `tests/test_e2e/` that cover ports, utility processes and service workers.
- **P6**: `writer/renderer/helper-types.ts`, `hooks-base.ts`, `hooks-react.ts`, `hooks-vue.ts`, `mock-runtime.ts`, `mock-writer.ts`, `renderer-declaration.ts`; for migration: `config.ts`, `config-outputs.ts`, `parser/channel/*`, `writer/main/main-reserved-names.ts`, `output-files.ts`, `stale-files.ts`, `package.json` (engines), and the 0.2.x to 1.0 differences visible in `src/` (the migration claims are checked against the current code, not against history).
- **P7**: `writer/main/main-validation.ts`, `main-support.ts`, `main-bindings.ts`, `scopes.ts`, `validation/*`, `writer/main/main-listeners.ts`, `writer/preload/preload-bindings.ts`, `tests/test_electron/` for sender validation and `senderFrame` behavior.

## 4. README example convention

The test `tests/test_e2e/automation/readmeExamples.test.ts` calls `extractReadmeExamples` (in `tests/utils/e2e/readme-examples.ts`) on the README text. Tags are `<!-- readme-example: <name> <file> -->` on the line directly above a `ts`/`typescript`/`json` fence.

After the move:

1. **The tags move with the code blocks, unchanged.** Same name, same file, same fence language, tag directly above the fence. Do not rename an example, split one example across two pages, or leave a tag orphaned. Keep all blocks of one example on the same page, in the same order. Example names are global across the site; if two pages need similar code, use distinct names.
2. **Which pages hold which examples** (from the current README): `preload-compose` and `electron-vite` in `docs/tooling/`; `getting-started` and `simple-example` in `docs/getting-started/`; `verbs` in `docs/schema/`; `kind-*` examples (invoke, errors, and the rest of lines 974-2467) in `docs/channels/` and `docs/processes/`; the examples of the later sections wherever their text lands. `grep -n "readme-example" README.md` lists all 65 tags on the commit of this plan.
3. **P1 changes the test** (and the helper only if needed) so that it reads all `*.md` files below `docs/` recursively, skipping `docs/tasks/` and `docs/roadmap.md`, in sorted path order, concatenates them with a blank line between files, and passes that text to `extractReadmeExamples` and `countExampleTags`. Keep the two existing sanity tests: `getting-started` and `simple-example` are present, and every tag matches a block. The error messages keep the example name; add the page path to the message if it is cheap. The README itself is no longer read for examples. Rename the describe blocks to say "docs examples" and update the comment in `tests/utils/e2e/all-fixtures.ts:21` and `tests/utils/e2e-utils.ts:48` if they mention the README.
4. The set of examples after the migration must equal the set before it (65 tags; same names). P1 verifies this with a script before and after, and the final pass re-checks it.
5. Type-checked examples are the only guarantee that docs code compiles, so a worker who rewrites a tagged block (even to tighten it) runs `bunx vitest run tests/test_e2e/automation/readmeExamples.test.ts` once P1's test change has landed, or until then compares the block byte-for-byte with the original.

## 5. Order of work

1. P2, P3, P4, P5, P6, P7 in parallel (they read the README on the plan's commit, write only their own dirs). They do not run the examples test until step 2 is done; they compare tagged blocks with the originals instead.
2. P1: docs part can run in parallel with step 1. The README rewrite and the test change run last, after steps 1 reports, in one commit. Then `bun run check` and `bunx vitest run` must be green.
3. Final high-effort pass: source against docs coverage, readability, link and anchor check across the whole site, `{{`/`{%` Liquid check, front matter and nav check, 65 examples still present.
4. Only then: delete `docs/tasks`, `docs/roadmap.md`, and update `CLAUDE.md` (it imports `@docs/roadmap.md` at line 104 and refers to it at lines 46-96) and any test that reads them; remove the `exclude` entries from `_config.yml`. Delete this plan file last.

## 6. Things to know

- The README is 3332 lines; line ranges above are on the commit of this plan. `grep -n '^#' README.md` gives the headings.
- `package.json` `files` ships `README.md` only, which is fine: the docs live on the site and the repository. Mention nothing about npm shipping docs.
- `CLAUDE.md` must not be edited by P1-P7.
- Pages must be enabled by the repository owner (Settings, Pages, branch, `/docs`) once the branch is merged to the default branch; nothing in the repo can do that.
