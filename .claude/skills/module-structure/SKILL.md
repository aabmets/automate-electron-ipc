---
name: module-structure
description: >-
  File size gate (soft 280 lines, hard 300, for src, tests and types), the ratchet baseline
  `size-baseline.json`, how to split a module or a test file along feature seams without a
  barrel file, and the anti-patterns of stub files and premature directories. Read before
  adding a file, before adding code to a file that is close to or over the limit, when
  `bun run check` reports a size error, and when a task is a T103+ split task.
---

# Module structure and the size gate

A module of 3000 lines is a failure of structure, not of style. The generator grew one feature per
task, and each task made `main-bindings.ts` bigger. The gate stops that.

## The limits

Counted in lines, **without the license header**; blank lines and comments count.

| Limit | Lines | Meaning |
|:--|--:|:--|
| Soft | 280 | Split by default. `bun run check` warns. |
| Hard | 300 | Never exceed. `bun run check` fails. |

They apply to every `.ts`, `.cts`, `.mts`, `.js`, `.cjs` and `.mjs` file under `src/`, `tests/` and
`types/`, test files and helpers included. `tests/fixtures/**` is exempt: those files are schema
input for the generator, not code.

`bun run check` runs `scripts/check-size.ts` after tsc and Biome. Its logic is `scripts/size-gate.ts`.

## The baseline: files that are already too big

`size-baseline.json` lists every file that was over the hard limit when the gate arrived, with its
size. The split tasks (see the roadmap, "Module structure") work it down to nothing.

- A file in the baseline may **only shrink**. One line more is an error.
- A file which shrank must have its entry lowered, and one which fits the hard limit must have its
  entry removed. Run `bun scripts/check-size.ts --update`; it only lowers and removes.
- **Never raise an entry, and never add a file to it.** A new file over 300 lines is split, not
  baselined. If you think a file needs an exception, stop and ask the user.
- Commit the baseline change in the same commit as the shrink.

## When your change touches a big file

Putting new code into a file at or near the limit is the habit that made the big files. Instead:

1. Put the new code in a **new module** that the old file calls. This is the right shape even when
   the old file is still in the baseline and could, on paper, hold the lines.
2. Do **not** split a baselined file as a drive-by. Only the task whose goal is that split does it.
   Make the minimal change the current task asks for, and say in your reply that the file is over the
   gate and that splitting it is out of scope.
3. If the current task is itself a split task, follow "How to split" below.

## The stub exemption (280 to 300)

A file may sit between 280 and 300 lines only if every available split would give a new file of
**30 lines or fewer**, counting its header and imports. A file that small buys nothing: the
indirection costs more than the lines it removes.

- Look for the split first. If the real seam gives a 40-line module, take it and split at 280.
- Prefer moving shared behavior up to a base class or an existing shared module over a new file.
- Between 280 and 300, say in your reply why no split above 30 lines exists.
- The exemption ends at 300. A file at 300 whose every split is a stub is doing too much at too fine
  a grain: merge the stubs into one cohesive module, or lift shared logic, rather than grow it.

## How to split

**Along the feature seam, not along line numbers.** `MainBindingsWriter`, for example, is a list of
`build*` methods that group by feature: scopes and the target resolver, sender and argument
validation, renderer-to-main channels, main-to-renderer and `ask`, streams, ports, utility and
brokered channels, service workers. One module per group; the writer calls them in order.

- A TypeScript class body cannot span files. Move a group into its own class or set of functions
  that takes what it reads from the writer as explicit arguments; put helpers that several groups use
  on `BaseWriter` or in one shared module. Decide the shape in the plan, before moving code.
- **No barrel files.** Biome has `noBarrelFile` and `noReExportAll` on, so do not leave the old file
  behind re-exporting what moved. Update every importer (src and tests) to the new path instead.
- **The behavior stays byte-identical.** Before the first edit, generate the output of every fixture
  in `tests/fixtures` into the scratchpad. After the split, generate again and `diff -r`. The
  exact-output tests assert on generated text, so a changed byte fails them as well.
- A split commit changes no assertion and no behavior. If a split exposes a bug, record it as a new
  task (the `it.fails` rule of `CLAUDE.md`) and leave it.
- New files carry the Apache-2.0 header and use the repo's Biome style (3-space indent).

**Splitting a test file** is moving `describe` blocks, not rewriting them:

- Name each new file after the area its tests cover, in the same directory (`ports.test.ts` becomes
  `ports.invoke.test.ts` and `ports.lifecycle.test.ts`, say), so that a failing name points to the
  area.
- Builders and fakes that two new files share go to `tests/utils/`, not into one file that the other
  imports.
- The number of tests before and after must be equal. Compare the vitest summary of the file's
  directory, plus `it.fails` and `it.skip` counts.
- Mirror the layout of the source modules when their split has landed. When it has not, follow the
  describe blocks.

## Anti-patterns

- A base class with one subclass, an interface-only module, a directory that only re-exports.
- A file under ~30 lines that one caller uses, made only to get another file under the limit.
- A pass-through wrapper whose only job is to rename another function.
- A new directory for a handful of files. Stay flat until a directory would hold more files than the
  eye takes in; `src/writer/` is the one existing grouping.
- Duplicating a helper in two new modules because sharing it needs a third. Put it where both can
  import it.

## Related

- Tests: [`vitest-conventions`](../vitest-conventions/SKILL.md)
- Session protocol and the roadmap: `CLAUDE.md`
