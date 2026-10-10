# TypeScript configuration

The generated files are TypeScript source, so the projects that compile your app must include them, and
the compiler options must suit the code in them.

## Which project compiles which file

An Electron app has up to four kinds of code, and the generated
files follow them:

| Code | Files | Needs |
|:--|:--|:--|
| Main process | `main.ts`, and `utility.ts` for the code of a utility process | The Node types, which `electron` brings in. |
| Preload script | `preload.ts`, `preload.<scope>.ts` | The `DOM` lib, since the script uses DOM types such as `MessagePort` (port channels) and `File` (`getPathForFile`). |
| Renderer | `window.d.ts` (or `window.<scope>.d.ts`), `types.ts`, `mock.ts`, `hooks.react.ts` or `hooks.vue.ts` | The `DOM` lib. Include only one `window*.d.ts` in a project, since each declares the same global. |
| Service worker | `service-worker-preload.ts`, `service-worker.d.ts` | The `WebWorker` lib, in a project of its own: its typings declare the same global as `window.d.ts`. |

 - `types.ts` imports the channel map from `schema.ts`, so the schema is part of every project that
   includes `types.ts` (the renderer, in the table above). It also has a type-only import from
   `automate-electron-ipc`, so the package must resolve from the renderer project. `main.ts`, `utility.ts` and `types.ts` import
   the types that your signatures use from your own files, so those are part of those projects too.
 - The generated files compile under `strict`, and with a `lib` of `ES2022` and `DOM`. They also compile
   under `noUnusedLocals`, `noUnusedParameters` and `noImplicitReturns`, which the node project of the
   electron-vite template turns on: a file holds only the helpers that its channels use.

## Module resolution

The generated files import each other and your types without an extension, as
`import type { User } from "../shared/types"`. That resolves with a `moduleResolution` of `bundler` (the
one of Vite and electron-vite) or `node10`. When `module` and `moduleResolution` are `NodeNext`, the imports
need extensions, and `projectUsesNodeNext` (detected, see [NodeNext](configuration.md#nodenext)) makes the generated
files spell them: `"../shared/types.js"`, `"./types.js"`. Your own schema files are compiled by your
project, so their imports follow its rules.

## A plain Electron project

A project with one `tsconfig.json` needs only the right `include`:

```json
{
   "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "lib": ["ES2022", "DOM"],
      "strict": true
   },
   "include": ["src"]
}
```

With `ipcDataDir` at `src/autoipc`, `src` holds every generated file. If you move the files out of `src`
with the path options, `include` must follow them.

## electron-vite

electron-vite splits the project in two: `tsconfig.node.json` compiles the main process and the preload
script, and `tsconfig.web.json` the renderer, and `tsconfig.json` only refers to them. Their `include` lists
do not reach `src/autoipc`, so add the generated files that each project compiles:

```jsonc
// tsconfig.node.json
{
   "include": [
      "electron.vite.config.*",
      "src/main/**/*",
      "src/preload/**/*",
      "src/autoipc/main.ts",
      "src/autoipc/preload.ts"
   ]
}

// tsconfig.web.json
{
   "include": [
      "src/renderer/src/**/*",
      "src/autoipc/window.d.ts",
      "src/autoipc/types.ts",
      "src/autoipc/schema.ts"
   ]
}
```

 - Add `utility.ts` to the node project when the schema has channels for a utility process. The preload
   script needs the `DOM` lib, which the template has, since it sets no `lib` and the default one includes it:
   a project that sets `lib` must list `"DOM"`.
 - Both projects of the electron-vite template are `composite`, and a composite project fails with TS6307
   on every file of its program that `include` does not list. That is why `schema.ts` is in the list of the
   web project, and why the files that your signatures import types from, such as `src/shared/**/*`,
   must be in both lists if they are not in them already.
 - With [scopes](../security/scopes.md), list the `window.<scope>.d.ts` and `types.<scope>.ts`
   of one scope in each renderer project, instead of `window.d.ts` and `types.ts`.
 - The `tsconfig.json` of an electron-vite project holds no `compilerOptions`, so NodeNext is not detected
   from it. The template resolves with `bundler`, for which nothing needs to be set; if a project of yours
   uses NodeNext, set `projectUsesNodeNext` yourself.
