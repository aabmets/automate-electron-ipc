# Vite and electron-vite

`automate-electron-ipc/vite` is a plugin that generates the bindings when a build starts, and again
when the schema or the config changes while the dev server runs. It works in plain Vite and in
electron-vite. Vite is not a dependency of this package: the plugin only needs the one you have.

```ts
// electron.vite.config.ts
import { autoipc } from "automate-electron-ipc/vite";
import { defineConfig } from "electron-vite";

export default defineConfig({
   main: { plugins: [autoipc()] },
   preload: { plugins: [autoipc()] },
   renderer: { plugins: [autoipc()] },
});
```

In plain Vite, add `autoipc()` to `plugins` of `vite.config.ts` in the same way. The plugin is named
`automate-electron-ipc`.

## Options

`autoipc(options?)` takes the options of [`generate`](node-api.md#options): `cwd`, `configFile`,
`overrides` and `logger`. The logger is on unless you set it, so the plugin prints the same lines as
`ipcgen`.

## When it runs

 - **At the start of a build, and of the dev server.** The plugin generates the files in its
   `buildStart` hook. An error stops the build: a schema that does not parse or validate, a config
   that is not valid, or a schema path that does not exist. Unlike `ipcgen`, the plugin does not create
   the missing directory.
 - **While the dev server runs**, when a schema file changes: `schema.ts`, or a `.ts`, `.mts` or `.cts`
   file under the `schema` directory. An error is printed and the server keeps running; the generated
   files of the last good run stay in place. Vite does not reload the page for a change of a schema
   file, because the schema is not part of the app.
 - **While the dev server runs**, when the config changes: `package.json`, `tsconfig.json` or the
   `autoipc.config.*` file (or the file named by `configFile`). The files are regenerated, and Vite then
   handles that file as usual. The generated files themselves never start a run.

## electron-vite

electron-vite starts the main, preload and renderer builds in one process. Add the plugin to each
build that imports the generated files, and the generator still runs once: the builds share the run.
Plugins that were given the same `cwd`, `configFile` and `overrides` share runs; a plugin with other
options runs on its own. Edits that come during a run cause exactly one more run after it.

## The preload build

The generated `preload.ts` has to end up as a single CommonJS file for a sandboxed window, and the
serializer module has to be bundled into it. That is a matter of how the preload build is configured,
not of the plugin. See [Preload bundling and the sandbox](preload-bundling.md), and
[electron-vite end to end](electron-vite.md) for a complete setup.
