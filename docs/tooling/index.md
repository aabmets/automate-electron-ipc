# Tooling

The generator, `ipcgen`, reads your schema and writes the typed bindings for the main process, the
preload script and the page. This section covers how to configure it, how to run it, and how to fit
its output into your build and your TypeScript projects. It needs Node.js 22.13 or later.

## Pages

| Page | What it covers |
|:--|:--|
| [Configuration](configuration.md) | Every option, the config file, precedence, NodeNext detection and the error messages. |
| [Command line](command-line.md) | The `ipcgen` flags, `--check` for CI and watch mode. |
| [Node API](node-api.md) | `generate` and `check` from `automate-electron-ipc/api`. |
| [Vite and electron-vite](vite.md) | The `automate-electron-ipc/vite` plugin. |
| [TypeScript configuration](typescript-configuration.md) | Which `tsconfig` project compiles which generated file. |
| [Generated files](generated-files.md) | The files a run writes, their headers and how stale files are removed. |
| [Preload bundling and the sandbox](preload-bundling.md) | Getting `preload.ts` into a sandboxed window, `autoExpose` and `isolatedWorldId`. |
| [electron-vite end to end](electron-vite.md) | A walk-through from `npm create @quick-start/electron` to a working typed IPC. |

## What the package contains

| Import or command | What it is |
|:--|:--|
| `automate-electron-ipc` | What the schema and the config file import: `defineChannels`, the verbs such as `invoke` and `emit`, `defineConfig` and the types. The verbs only describe a channel for the generator; running one prints a warning and does nothing. |
| `automate-electron-ipc/api` | `generate` and `check`, see [Node API](node-api.md). |
| `automate-electron-ipc/vite` | The `autoipc` plugin, see [Vite and electron-vite](vite.md). |
| `ipcgen` | The command, see [Command line](command-line.md). |

## A typical setup

1. Write the schema, and set the options you need in [`package.json` or a config file](configuration.md).
2. Generate the files on every build with the [Vite plugin](vite.md), or run [`ipcgen`](command-line.md)
   (with `--watch` while you develop).
3. Include the [generated files in your tsconfig projects](typescript-configuration.md).
4. Make sure the [preload script is bundled](preload-bundling.md) as one CommonJS file.
5. Run `ipcgen --check` in CI to catch generated files that are out of date.
