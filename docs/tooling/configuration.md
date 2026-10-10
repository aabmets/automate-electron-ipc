# Configuration

The generator works without any configuration. This page lists every option with its default, shows
where to set it, and explains how the sources are combined and which errors you can get.

## Setting options

The simplest place for options is `package.json`, under `config.autoipc`:

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

The same options can live in a [config file](#config-file) instead. Paths are relative to the project
root, which is the directory of the nearest `package.json`. If no `package.json` exists in the working
directory or above it, the run fails with `Cannot find the project root: no package.json in '<dir>' or any parent directory.`

An option with a name that does not exist, or a value that is not valid, fails the run with a message
that names its source:

```text
Unknown config key 'foo' in package.json#config.autoipc. Known keys: autoExpose, channelPrefix, ...
Invalid config in package.json#config.autoipc: At path: codeIndent -- value cannot be less than 2 or greater than 4
```

The source is `package.json#config.autoipc`, the name of the config file, or `the run options` when the
bad value came from a command line flag or from `overrides` of the [Node API](node-api.md). All the
messages are listed in [Configuration errors](#configuration-errors).

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

## Details of the options

### Where the files go

 - `ipcDataDir` is the directory of `schema.ts` (or of the `schema` directory), and it is where the
   files that have no path option of their own are written: `types.ts`, `mock.ts` and the hooks. A run of
   `ipcgen` that finds no schema creates the directory. It must be relative to the project root.
 - The path options (`mainBindingsPath`, `preloadBindingsPath`, `rendererTypesPath`,
   `utilityBindingsPath` and `serviceWorkerPreloadPath`) must be relative to the project root and name a
   file of the right kind: a `.ts` file for `main.ts` and `preload.ts`, a `.d.ts` file for
   `window.d.ts`, and a `.ts`, `.mts` or `.cts` file for the other two. A declaration file (`.d.ts`) is
   not accepted where a source file is expected.
 - A path option must not be the path of another generated file, or of a file that the run reads, such
   as the schema, a file of the `schema` directory or the module of a relative `serializer`; either is
   an error that names the option. The comparison ignores case on a file system that does. The
   `mock.ts` and hooks files count as taken only while `mock` and `hooks` are on.
 - The files of the scopes are written next to `preloadBindingsPath` and `rendererTypesPath` (and
   `types.ts`). A scope whose file would land on `mainBindingsPath`, `utilityBindingsPath` or
   `serviceWorkerPreloadPath` is an error too. `utility.ts` and the service worker files are written
   only when the schema has a channel for them. See [Generated files](generated-files.md).
 - `mock` and `hooks` cover the surface of no scope. A channel cannot be named `emit` or `ask` while
   `mock` is on.

### The API in the page

 - `exposeAs` must be an identifier that is not a reserved word or a global of the page (`name`,
   `status`, `close`, `open`, `Promise`, ...), since the exposed API would hide it. The generated
   `window.d.ts` declares the global variable under the same name. The `ipc` object of `main.ts` is not
   affected.
 - `isolatedWorldId` uses `contextBridge.exposeInIsolatedWorld`. Electron keeps the IDs below 1000 for
   itself. Only the scripts that run in that world see the API, so the world needs to be created for
   the page, for example with `webFrame.setIsolatedWorldInfo`. See
   [Preload bundling and the sandbox](preload-bundling.md#isolatedworldid-expose-the-api-to-an-isolated-world).
 - `autoExpose` set to `false` leaves the exposing to your own preload code, which can then use another
   key or run code first. See [Preload bundling and the sandbox](preload-bundling.md#autoexpose-let-the-file-expose-the-api-or-do-it-yourself).
 - `getPathForFile` exists because `File.path` was removed in Electron 32, so a page that handles dropped
   or picked files can get their path only from the preload script, through `webUtils.getPathForFile`.
   The helper returns an empty string for a `File` that is not on the disk, and throws for a value that is
   not a `File`. A channel cannot be named `getPathForFile` while this is on. It is in the API of every
   scope, and in the empty API of a schema without channels for the page. A path tells the page about
   the disk of the user: pass it on only to code you trust.

### Channel names, errors and timeouts

 - `channelPrefix` makes `getUser` travel as `autoipc:getUser`, so that the channels cannot collide
   with other code that uses `ipcMain` or `ipcRenderer` directly. The names of the generated API stay as
   they are in the schema, and so do the names that `validateSender`, `onRejected` and the errors
   receive. It can contain letters, digits and `_ . : / @ # -`, up to 64 characters. It separates channel
   names and is not a security measure: restrict who can call a channel with `allowedOrigins`.
 - `rawErrors` makes the errors of `invoke` handlers reach the page as Electron reports them
   (`Error invoking remote method 'X': Error: message`), not as the error object of the library, which
   has a name, a message, a code and data.
 - `timeoutMs` is the default of `invoke`, and also of `callUtility`, `callMain`, `invokeUtility`
   (which reject with an `IpcUtilityError` of the code `IPC_UTILITY_TIMEOUT`) and `invokeFromWorker`.
   A channel's own `timeoutMs` wins. It is not a default for `send`, `ask` and the stream verbs. See
   [Timeouts](../channels/invoke.md#timeouts). It must be a safe integer of 0 or more.
 - `serializer` is applied to everything that crosses between a page, a utility process or a service
   worker and the main process, and to the messages of `port` and `mainPort` channels. A value that
   starts with `.` is a path from the project root and must start with `./` or `../`, such as
   `"./src/wire.ts"`; any other value is a package name, such as `"superjson"` or `"@scope/wire"`.

### Code style

 - `codeIndent` is checked: a value below 2 or above 4, or one that is not an integer, is an error.
 - `format` runs the formatter from `node_modules/.bin` of the project root, with the project root as its
   working directory, so your own formatter config applies. The file is passed on the standard input,
   with its path relative to the project root: `biome format --stdin-file-path=<file>`, or
   `prettier --stdin-filepath <file>`. The header at the top of each file is not formatted. If the
   binary is not installed, a warning is printed once per run and the files are written unformatted:

   ```text
   The config 'format' is 'biome', but 'node_modules/.bin/biome' does not exist.
   The generated files are written unformatted. Install the formatter in the project.
   ```

   A formatter that exits with an error fails the run with `The formatter 'biome' failed on '<file>':`
   followed by its output. `--check` and the programmatic API compare the formatted text, so run them with
   the same `format` as the run that wrote the files.

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
   `package.json#config.autoipc` is an error, since the two are not merged. An empty
   `config.autoipc` object does not count.
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

## Configuration errors

Every error below fails the run (the [Node API](node-api.md) throws it). `<source>` is the source
described in [Setting options](#setting-options).

| Message | Cause |
|:--|:--|
| `Unknown config key '<key>' in <source>. Known keys: ...` | The option does not exist. |
| `Invalid config in <source>: At path: <option> -- <reason>` | The value is not valid. The reasons are in the next table. A value of the wrong type is reported with the type that was expected. |
| `The config is set in both '<file>' and 'package.json#config.autoipc'; keep one.` | Both sources hold options. |
| `The project has more than one config file: '<a>' and '<b>'. Keep one.` | The root holds more than one `autoipc.config.*` file. |
| `The config file '<path>' does not exist.` | The file of `--config` is missing. |
| `Cannot read the config file '<path>': use a .json, .mjs or .ts file.` | The file of `--config` has another extension. |
| `Cannot load the config file '<file>': <reason>` | The file does not parse or throws when it runs. |
| `The config file '<file>' must give an object as its config.` | The export is not an object (or a function that returns one). |
| `Cannot parse '<package.json>': it is not valid JSON. <reason>` | `package.json` does not parse. |
| `Cannot read '<package.json>': 'config' must be an object, but it is ...` | `config`, or `config.autoipc`, is not an object. |
| `The config '<option>' ('<value>') is the path of another generated file. Choose a different path.` | Two outputs would land on one file. |
| `The config '<option>' ('<value>') is the schema file, which the run would overwrite. Choose a different path.` | An output path is a file that the run reads. It says `a schema file` for a file of the `schema` directory, and `the serializer module` for a relative `serializer`. |
| `The config '<option>' ('<value>') is the file that the scope '<scope>' is generated to. Choose a different path.` | The file of a scope would land on `mainBindingsPath`, `utilityBindingsPath` or `serviceWorkerPreloadPath`. |
| `Schema file '<file>' (<line>:<column>): Channel name '<name>' is reserved, since the config '<option>' adds a member of that name to the API. Rename the channel, or turn the config off.` | A channel is named `getPathForFile` (with `getPathForFile` on), or `emit` or `ask` (with `mock` on). |

The reasons of an invalid value:

| Option | Reason |
|:--|:--|
| `ipcDataDir`, the path options | `<option> must be relative to the project root` |
| `mainBindingsPath`, `preloadBindingsPath`, `utilityBindingsPath`, `serviceWorkerPreloadPath` | `<option> must be the path of a .ts file` |
| `rendererTypesPath` | `rendererTypesPath must be the path of a .d.ts file` |
| `channelPrefix` | `channelPrefix cannot be longer than 64 characters`, or `channelPrefix can contain only letters, digits and _ . : / @ # -` |
| `timeoutMs` | `timeoutMs must be a non-negative integer` |
| `exposeAs` | `exposeAs must be an identifier: letters, digits, _ and $, not starting with a digit`, or `exposeAs '<name>' is a reserved word or a global of the page. Choose another name.` |
| `isolatedWorldId` | `isolatedWorldId must be an integer of 1000 or more, up to 2147483647` |
| `format` | `format must be 'biome', 'prettier' or false` |
| `hooks` | `hooks must be 'react', 'vue' or false` |
| `serializer` | `serializer must start with ./ or ../ when it is a path in the project`, or `serializer must be a package name such as 'superjson', or a path that starts with ./ or ../` |
| `codeIndent` | `value must be an integer`, or `value cannot be less than 2 or greater than 4` |
