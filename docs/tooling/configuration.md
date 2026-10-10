# Configuration

The generator works without any configuration, using the defaults in the table below. This page lists
every option, shows where to set it, and explains how the sources are combined.

## Setting options

To change an option, set it in `package.json`, under `config.autoipc`:

```json
{
   "config": {
      "autoipc": {
         "ipcDataDir": "src/ipc",
         "codeIndent": 2,
         "mock": true
      }
   }
}
```

The same options can live in a config file instead, see [Config file](#config-file). Paths are relative
to the project root, which is the directory of the nearest `package.json`. An option with a name that
does not exist, or a value that is not valid, fails the run with a message that names its source:

```text
Unknown config key 'foo' in package.json#config.autoipc. Known keys: autoExpose, channelPrefix, ...
Invalid config in package.json#config.autoipc: At path: codeIndent -- value cannot be less than 2 or greater than 4
```

The source is `package.json#config.autoipc`, the name of the config file, or `the run options` when the bad
value came from a command line flag or from `overrides` of the [Node API](node-api.md).

## Options

| Option | Type | Default | Description |
|:--|:--|:--|:--|
| `ipcDataDir` | string | `"src/autoipc"` | The directory with the schema, where the generated files are written. |
| `codeIndent` | `2`, `3` or `4` | `3` | The spaces of one indentation level in the generated files. |
| `projectUsesNodeNext` | boolean | detected from `tsconfig.json` | Spells the imports of the generated files as NodeNext does. See [NodeNext](#nodenext). |
| `rawErrors` | boolean | `false` | Leaves the errors of `invoke` handlers to Electron. See [Errors](../channels/invoke.md#errors). |
| `channelPrefix` | string | `"autoipc:"` | Put in front of every channel name that Electron sees. `""` turns it off. |
| `timeoutMs` | integer, 0 or more | `0` | The default time limit of the calls that wait for an answer; `0` waits for ever. See [Timeouts](../channels/invoke.md#timeouts). |
| `exposeAs` | identifier | `"ipc"` | The name of the API in the page: `window.ipc`. |
| `isolatedWorldId` | integer, 1000 to 2147483647 | not set | Exposes the API in this isolated world, not in the main world. |
| `autoExpose` | boolean | `true` | Whether `preload.ts` exposes the API when it loads. See [Preload bundling and the sandbox](preload-bundling.md). |
| `getPathForFile` | boolean | `false` | Adds `getPathForFile(file)` to the API of the page. |
| `serializer` | string | not set | A module that serializes what crosses a process boundary. See [Custom serializers](../schema/custom-serializers.md). |
| `mainBindingsPath` | `.ts` path | `<ipcDataDir>/main.ts` | Where `main.ts` is written. |
| `preloadBindingsPath` | `.ts` path | `<ipcDataDir>/preload.ts` | Where `preload.ts` is written. |
| `rendererTypesPath` | `.d.ts` path | `<ipcDataDir>/window.d.ts` | Where `window.d.ts` is written. |
| `utilityBindingsPath` | `.ts`, `.mts` or `.cts` path | `<ipcDataDir>/utility.ts` | Where `utility.ts` is written. |
| `serviceWorkerPreloadPath` | `.ts`, `.mts` or `.cts` path | `<ipcDataDir>/service-worker-preload.ts` | Where the preload script of service workers is written. |
| `mock` | boolean | `false` | Writes `mock.ts`. See [Mocking in renderer tests](../renderer/mocking.md). |
| `hooks` | `"react"`, `"vue"` or `false` | `false` | Writes `hooks.react.ts` or `hooks.vue.ts`. See [Framework hooks](../renderer/framework-hooks.md). |
| `format` | `"biome"`, `"prettier"` or `false` | `false` | Formats the generated files with the formatter of your project. |

## Notes on the options

 - `ipcDataDir` is the directory of `schema.ts` (or of the `schema` directory), and it is where the
   files that have no path option of their own are written: `types.ts`, `mock.ts` and the hooks. A run that
   finds no schema creates it. It must be relative to the project root.
 - `codeIndent` is checked: a value below 2 or above 4, or one that is not an integer, is an error.
 - `rawErrors` makes the errors of `invoke` handlers reach the page as Electron reports them, not as
   the error object of the library.
 - `channelPrefix` makes `getUser` travel as `autoipc:getUser`, so that the channels cannot collide
   with other code that uses `ipcMain` or `ipcRenderer` directly. The names of the generated API stay as
   they are in the schema, and so do the names that `validateSender`, `onRejected` and the errors
   receive. It can contain letters, digits and `_ . : / @ # -`, up to 64 characters. It separates channel
   names and is not a security measure: restrict who can call a channel with `allowedOrigins`.
 - `timeoutMs` is the default of `invoke`, and also of `callUtility`, `callMain`, `invokeUtility`
   (which reject with an `IpcUtilityError` of the code `IPC_UTILITY_TIMEOUT`) and `invokeFromWorker`.
   A channel's own `timeoutMs` wins. See [Timeouts](../channels/invoke.md#timeouts). It must be a safe
   integer of 0 or more.
 - `exposeAs` must be an identifier that is not a reserved word or a global of the page (`name`,
   `status`, `close`, `open`, `Promise`, ...), since the exposed API would hide it. The generated
   `window.d.ts` declares the global variable under the same name. The `ipc` object of `main.ts` is not
   affected.
 - `isolatedWorldId` uses `contextBridge.exposeInIsolatedWorld`. Electron keeps the IDs below 1000 for
   itself. Only the scripts that run in that world see the API, so the world needs to be created for
   the page, for example with `webFrame.setIsolatedWorldInfo`. See
   [Preload bundling and the sandbox](preload-bundling.md#isolatedworldid-expose-the-api-to-an-isolated-world).
 - `getPathForFile` exists because `File.path` was removed in Electron 32, so a page that handles dropped
   or picked files can get their path only from the preload script, through `webUtils.getPathForFile`.
   The helper returns an empty string for a `File` that is not on the disk, and throws for a value that is
   not a `File`. A channel cannot be named `getPathForFile` while this is on. It is in the API of every
   scope, and in the empty API of a schema without channels for the page. A path tells the page about
   the disk of the user: pass it on only to code you trust.
 - `serializer` is applied to everything that crosses between a page, a utility process or a service
   worker and the main process, and to the messages of `port` and `mainPort` channels. A value that
   starts with `.` is a path from the project root and must start with `./` or `../`, such as
   `"./src/wire.ts"`; any other value is a package name, such as `"superjson"` or `"@scope/wire"`.
 - The path options (`mainBindingsPath`, `preloadBindingsPath`, `rendererTypesPath`,
   `utilityBindingsPath` and `serviceWorkerPreloadPath`) must be relative to the project root and name a
   file of the right kind: a `.ts` file for `main.ts` and `preload.ts`, a `.d.ts` file for
   `window.d.ts`, and a `.ts`, `.mts` or `.cts` file for the other two. They must not be the path of
   another generated file, or of a file that the run reads, such as the schema, a file of the `schema`
   directory or the module of a relative `serializer`; either is an error that names the option. The
   comparison ignores case on a file system that does. The `mock.ts` and hooks files count as taken only
   while `mock` and `hooks` are on.
 - The files of the scopes are written next to `preloadBindingsPath` and `rendererTypesPath` (and
   `types.ts`). A scope whose file would land on `mainBindingsPath`, `utilityBindingsPath` or
   `serviceWorkerPreloadPath` is an error too. `utility.ts` and the service worker files are written
   only when the schema has a channel for them. See [Generated files](generated-files.md).
 - `mock` and `hooks` cover the surface of no scope. A channel cannot be named `emit` or `ask` while
   `mock` is on.
 - `format` runs the formatter from `node_modules/.bin` of the project root, with the project root as its
   working directory, so your own formatter config applies. If the binary is not installed, a warning is
   printed once per run and the files are written unformatted; a formatter that exits with an error
   fails the run and names the file. The header at the top of each file is not formatted. `--check` and
   the programmatic API compare the formatted text, so run them with the same `format` as the run that
   wrote the files.

## Config file

Instead of `package.json#config.autoipc`, the options can be set in a config file in the project root
(the directory of the nearest `package.json`). The file is named `autoipc.config.json`,
`autoipc.config.mjs` or `autoipc.config.ts`:

```ts
// autoipc.config.ts
import { defineConfig } from "automate-electron-ipc";

export default defineConfig({
   ipcDataDir: "src/ipc",
   codeIndent: 2,
});
```

 - A `.json` file holds the config object. In an `.mjs` or `.ts` file, the default export is the config
   object, or a function (sync or async) that returns it. `defineConfig` only gives the object its type
   (`AutoIpcConfig`); it can be left out.
 - A `.ts` file is transpiled to a temporary `.mjs` file next to it (named `.autoipc.config.<random>.mjs`),
   which is deleted after it was read. Relative imports of `.ts` files from a `.ts` config file are not
   supported.
 - Paths in the config file are relative to the project root, like the ones in `package.json`.
 - The root may hold only one `autoipc.config.*` file. Setting the options in a config file **and** in
   `package.json#config.autoipc` is an error, since the two are not merged.
 - `--config <file>` (or `configFile` of the [Node API](node-api.md)) reads another `.json`, `.mjs` or
   `.ts` file instead of looking in the project root. A file that does not exist or has another
   extension is an error.
 - An option with a name that does not exist is an error that names the source and lists the known
   options. Every error about the config names the file, or `package.json#config.autoipc`, it comes from.
 - A config file that cannot be loaded, or whose export is not an object, fails the run and names the
   file. So does a `package.json` that is not valid JSON, or whose `config` or `config.autoipc` is not an
   object.

## Precedence

An option comes from the first of these that sets it:

1. The options of the run: the command line flags (`--out-main`, `--out-preload` and `--out-types` set
   path options), or `overrides` of the [Node API](node-api.md) and of the
   [Vite plugin](vite.md). An override that is `undefined` is ignored.
2. The one config source: the config file, or `package.json#config.autoipc`.
3. The detection of `projectUsesNodeNext`, which is the only option that is not a constant default.
4. The defaults of the table above.

## NodeNext

`projectUsesNodeNext` spells the imports of the generated files as NodeNext does, with `.js` extensions.
When you leave it out, it is detected: it is `true` when `module` or `moduleResolution` in the
`tsconfig.json` of the project root is `node16` or `nodenext` (in any letter case), and `false` otherwise
or without that file.

 - Only `tsconfig.json` is read, not `tsconfig.node.json` or `tsconfig.web.json`, since an electron-vite
   project has two of those and either could apply. Such a project does not use NodeNext, usually, but if
   one of its files does, set the option yourself.
 - A relative `extends` (one path or an array) is followed, and a package such as `@tsconfig/node22` is
   not. A relative base that does not exist, or a `tsconfig` that is not valid JSON, fails the run.
   Comments and trailing commas are allowed in the file.
 - Set the option to override the detection, in any config source or with the run options.
 - It also decides how the imports of your own files in the schema, such as the types of a signature,
   are spelled in the generated files. Under NodeNext a path gets its `.js` extension, a directory
   import names its index file, and data files such as `.json` keep their extension; `.mts` and `.cts`
   files are always spelled `.mjs` and `.cjs`. See [TypeScript configuration](typescript-configuration.md).
