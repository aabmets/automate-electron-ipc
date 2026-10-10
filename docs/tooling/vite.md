# Vite and electron-vite

`automate-electron-ipc/vite` is a plugin that generates the bindings when a build starts, and again
when the schema or the config changes while the dev server runs. Vite is not a dependency of this
package: the plugin only needs the one you have.

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

## Using the plugin

- `autoipc(options?)` takes the options of [`generate`](node-api.md): `cwd`, `configFile`, `overrides` and
  `logger`. The logger is on unless you set it.
- In plain Vite, add `autoipc()` to `plugins` of `vite.config.ts` in the same way.
- electron-vite starts the main, preload and renderer builds in one process. Add the plugin to each
  one that imports the generated files, and it still runs once: the builds share the run. Plugins that
  were given the same `cwd`, `configFile` and `overrides` share runs; a plugin with other options
  runs on its own.
- A schema error fails the build. In the dev server it is printed and the server keeps running; the
  generated files of the last good run stay in place. Vite does not reload the page for a change of
  a schema file, because the schema is not part of the app.
- The dev server also watches the config: a change of `package.json`, `tsconfig.json` or the
  `autoipc.config.*` file (or the file named by `configFile`) regenerates the files, and Vite then
  handles that file as usual.

## The preload build

The generated `preload.ts` has to end up as a single CommonJS file for a sandboxed window, and the
serializer module has to be bundled into it. That is a matter of how the preload build is configured,
not of the plugin. See [Preload bundling and the sandbox](preload-bundling.md), and
[electron-vite end to end](electron-vite.md) for a complete setup.
