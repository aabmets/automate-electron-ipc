# Node API

`automate-electron-ipc/api` runs the generator from your own code, for a build script or a test. It
takes the same options as the CLI and renders the files with the same pipeline.

```ts
import { check, generate } from "automate-electron-ipc/api";

const { files, channels } = await generate({ cwd: "packages/app" });
// files: the absolute paths that were written, sorted. channels: the number of channels.

const { stale } = await check({ overrides: { codeIndent: 2 } });
// stale: the generated files that are out of date or missing. Nothing is written.
```

## Options

Both functions take one optional options object (`GenerateOptions`):

| Option | Type | Description |
|:--|:--|:--|
| `cwd` | string | Find the project root from this directory. Default: the working directory. |
| `configFile` | string | The config file to read, relative to `cwd` or absolute, instead of the `autoipc.config.*` file in the project root. |
| `overrides` | `AutoIpcConfig` | Config options that win over the config source and the defaults. See [Configuration](configuration.md#precedence). |
| `logger` | boolean | Print the same lines as the CLI. Default: `false`. |

## Results

| Function | Returns | Meaning |
|:--|:--|:--|
| `generate(options?)` | `{ files, channels }` | `files`: the absolute paths of the files that were written, with `/` separators, sorted. `channels`: the number of channels in the schema. |
| `check(options?)` | `{ stale }` | `stale`: the absolute paths of the generated files that are out of date or missing, with `/` separators, sorted. It also lists the generated files that a run would delete. |

## Behavior

 - `generate` writes the files like `ipcgen`, and deletes the stale generated files (see
   [Generated files](generated-files.md#stale-files)). `check` compares the files with the ones on disk
   like `ipcgen --check`, and writes nothing.
 - Both are silent by default and never set `process.exitCode`.
 - They throw on errors: a schema that does not parse or validate, a config that is not valid (see
   [Configuration errors](configuration.md#configuration-errors)), and a schema path that does not exist.
   The message of the last one is that of the CLI warning on one line: `Skipping IPC automation, because
   schema path does not exist: <path>`. Unlike the CLI, `generate` does not create the missing directory.
 - A schema without channels is not an error: `generate` writes the files with an empty API and
   returns `channels: 0`.

The types `GenerateOptions`, `GenerateResult` and `CheckResult` describe the options and the results.
