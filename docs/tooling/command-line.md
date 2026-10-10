# Command line

`ipcgen` generates the bindings of the project that contains the working directory. This page lists its
flags, and describes the two modes that do not simply write the files: `--check` for CI and `--watch`.

## Flags

`ipcgen` takes these flags, which win over the config:

| Flag | Description |
|:--|:--|
| `--cwd <dir>` | Find the project root from this directory instead of the working directory. |
| `--config <file>` | Read this config file (`.json`, `.mjs` or `.ts`) instead of looking for `autoipc.config.*` in the project root. The path is relative to the directory that `--cwd` names, or to the working directory without `--cwd`. |
| `--out-main <file>` | Set `mainBindingsPath`. |
| `--out-preload <file>` | Set `preloadBindingsPath`. |
| `--out-types <file>` | Set `rendererTypesPath`. |
| `--check` | Write nothing; list the generated files that are out of date, and exit with `1` if there are any. |
| `--watch` | Generate once, then again whenever the schema or the config changes. Cannot be combined with `--check`. |
| `-v`, `--version` | Print the version. |
| `-h`, `--help` | Print the flags. |

The path of an `--out-*` flag, unlike the one in the config, is relative to the working directory (the one
`--cwd` names), and `ipcgen` converts it to a path from the project root. The imports in each generated file
are written for the directory that the file ends up in.

A run that fails, such as one with a schema that does not parse or validate, prints the error and exits
with `1`. When the schema file or directory does not exist, the run creates `ipcDataDir` and prints a warning
that says where to create the schema; see [Quickstart](../getting-started/quickstart.md).

## Checking that the generated files are up to date

`ipcgen --check` renders the files in memory and compares them with the ones on disk. It writes
nothing, lists the files that are out of date or missing (relative to the project root), and exits
with `1` if there are any. It also exits with `1` when the schema path does not exist, and creates
no directory. Use it in CI to catch a schema change whose generated files were not committed:

```yaml
- run: npx ipcgen --check
```

It takes `--cwd` and `--config` like a normal run. A generated file that a run would delete (see
[Generated files](generated-files.md#stale-files)) is listed as out of date too. The check compares the text
byte for byte, so run it with the same version of the library, and the same `format`, as the run that wrote
the files.

## Watch mode

`ipcgen --watch` generates the bindings once, then again whenever the schema or the config changes,
until you stop it with Ctrl+C (`SIGINT` or `SIGTERM`). It takes the same flags as a normal run (`--cwd`,
`--config` and the `--out-*` flags), and cannot be combined with `--check`.

 - These changes start a run: a `schema.ts` file or a `.ts` file under the `schema` directory in the
   `ipcDataDir`, and `package.json`, `tsconfig.json` and the `autoipc.config.*` file (or the one that
   `--config` names) in the project root. The generated files do not, so a run never starts the next.
 - Changes that come in a burst, like the ones of a save-all, start one run. Changes that come while a
   run is going start one more run after it.
 - A run that fails, such as one with a syntax error in the schema, prints the error and keeps
   watching; the bindings of the last good run stay in place until a run succeeds. Unlike a plain run,
   it does not set the exit code.
 - A change of the config that moves the `ipcDataDir` makes the watcher follow it. A config that is
   broken does not stop the watcher: it watches the project root until the config is fixed, and then
   starts a run. A data directory that does not exist yet is created by the first run, and watched
   from then on.
