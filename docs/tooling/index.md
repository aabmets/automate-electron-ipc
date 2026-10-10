# Tooling

The generator, `ipcgen`, reads your schema and writes the typed bindings for the main process, the
preload script and the page. This section covers how to configure it, how to run it, and how to fit
its output into your build and your TypeScript projects.

| Page | What it covers |
|:--|:--|
| [Configuration](configuration.md) | Every option, the config file, precedence and NodeNext detection. |
| [Command line](command-line.md) | The `ipcgen` flags, `--check` for CI and watch mode. |
| [Node API](node-api.md) | `generate` and `check` from `automate-electron-ipc/api`. |
| [Vite and electron-vite](vite.md) | The `automate-electron-ipc/vite` plugin. |
| [TypeScript configuration](typescript-configuration.md) | Which `tsconfig` project compiles which generated file. |
| [Generated files](generated-files.md) | The files a run writes, their headers and how stale files are removed. |
| [Preload bundling and the sandbox](preload-bundling.md) | Getting `preload.ts` into a sandboxed window, `autoExpose` and `isolatedWorldId`. |
| [electron-vite end to end](electron-vite.md) | A walk-through from `npm create @quick-start/electron` to a working typed IPC. |
