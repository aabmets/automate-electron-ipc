# Node API

The generator can also be run from code, with `automate-electron-ipc/api`. It takes the same
options as the CLI and renders the files with the same pipeline.

```ts
import { check, generate } from "automate-electron-ipc/api";

const { files, channels } = await generate({ cwd: "packages/app" });
// files: the absolute paths that were written, sorted. channels: the number of channels.

const { stale } = await check({ overrides: { codeIndent: 2 } });
// stale: the generated files that are out of date or missing. Nothing is written.
```

## Options

| Option | Type | Description |
|:--|:--|:--|
| `cwd` | string | Find the project root from this directory. Default: the working directory. |
| `configFile` | string | The config file to read, relative to `cwd` or absolute, instead of the `autoipc.config.*` file in the project root. |
| `overrides` | `AutoIpcConfig` | Config options that win over the config source and the defaults. See [Configuration](configuration.md#precedence). |
| `logger` | boolean | Print the same lines as the CLI. Default: `false`. |

## Behavior

- `generate(options?)` writes the files like `ipcgen`, deletes the stale generated files, and returns
  `{ files, channels }`. `check(options?)` compares the files with the ones on disk like `ipcgen --check`
  and returns `{ stale }`. Both lists hold absolute paths with `/` separators, sorted. `stale` also
  lists the generated files that a run would delete.
- Both are silent by default and never set `process.exitCode`.
- They throw on errors: a schema that does not parse or validate, and a schema path that does not
  exist, whose message is the one of the CLI warning. Unlike the CLI, `generate` does not create
  the missing directory.
