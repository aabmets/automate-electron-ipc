/*
 *   Apache License 2.0
 *
 *   Copyright (c) 2024, Mattias Aabmets
 *
 *   The contents of this file are subject to the terms and conditions defined in the License.
 *   You may not use, modify, or distribute this file except in compliance with the License.
 *
 *   SPDX-License-Identifier: Apache-2.0
 */

/**
 * The options of the generator. Set them in `package.json#config.autoipc` or in a config file
 * (`autoipc.config.json`, `.mjs` or `.ts`) in the project root. Paths are relative to the project root.
 */
export interface AutoIpcConfig {
   projectUsesNodeNext?: boolean;
   ipcDataDir?: string;
   codeIndent?: number;
   /**
    * Leaves the errors of `invoke` handlers to Electron, which reports them to the renderer as
    * `Error invoking remote method 'X': Error: message`. Off by default: the error then reaches
    * the renderer as an object with its name, message, code and data.
    */
   rawErrors?: boolean;
   /**
    * Put in front of every channel name that Electron sees, so that the channels cannot collide with
    * the ones of other code that uses `ipcMain` directly. `getUser` travels as `autoipc:getUser`.
    * The names in the generated API stay as they are in the schema. `""` turns the prefix off.
    */
   channelPrefix?: string;
   /**
    * The default time in milliseconds after which the promise of an `invoke` is rejected with an
    * `IpcTimeoutError`, when the handler has not answered. `0`, the default, waits for ever. The
    * `timeoutMs` option of a channel overrides it. It is also the default of the calls to a utility
    * process (`callUtility`, `callMain` and `invokeUtility`), which are rejected with an
    * `IpcUtilityError` of the code `IPC_UTILITY_TIMEOUT`, but not of `streamUtility`.
    */
   timeoutMs?: number;
   /**
    * The path of the generated bindings for the main process, relative to the project root.
    * Defaults to `main.ts` in `ipcDataDir`. It must be a `.ts` file.
    */
   mainBindingsPath?: string;
   /**
    * The path of the generated preload script, relative to the project root. Defaults to
    * `preload.ts` in `ipcDataDir`. The preload scripts of the scopes are written next to it, as
    * `preload.<scope>.ts`. It must be a `.ts` file.
    */
   preloadBindingsPath?: string;
   /**
    * The path of the generated typings of the renderer, relative to the project root. Defaults to
    * `window.d.ts` in `ipcDataDir`. The typings of the scopes are written next to it, as
    * `window.<scope>.d.ts`. It must be a `.d.ts` file.
    */
   rendererTypesPath?: string;
   /**
    * The path of the generated file for utility processes, relative to the project root. Defaults
    * to `utility.ts` in `ipcDataDir`. The file is written only if the schema has a channel to a
    * utility process.
    */
   utilityBindingsPath?: string;
   /**
    * The path of the generated preload script for service workers, relative to the project root.
    * Defaults to `service-worker-preload.ts` in `ipcDataDir`. The typings of the API of the worker
    * go to `service-worker.d.ts` next to it. Both files are written only if the schema has a
    * channel to or from a service worker.
    */
   serviceWorkerPreloadPath?: string;
   /**
    * The name that the API is exposed as in the page, and that `window.d.ts` declares it as.
    * Defaults to `"ipc"`. It must be an identifier that is not a reserved word or a global of the
    * page, such as `name` or `status`.
    */
   exposeAs?: string;
   /**
    * Exposes the API in the isolated world with this ID, with `contextBridge.exposeInIsolatedWorld`,
    * instead of in the main world. It must be an integer of 1000 or more, since Electron keeps the
    * lower IDs for itself. Without it, the API is exposed in the main world.
    */
   isolatedWorldId?: number;
   /**
    * Whether the generated `preload.ts` exposes the API as soon as it loads. On by default. Turn it
    * off to import `api` and `expose` from the preload file and expose the API from your own preload
    * code, under any number of keys.
    */
   autoExpose?: boolean;
   /**
    * Adds `getPathForFile(file: File): string` to the exposed API, which returns the path of a file
    * that the user dropped or picked, through `webUtils.getPathForFile`. Off by default.
    */
   getPathForFile?: boolean;
   /**
    * Formats the generated files with the formatter of your project: `"biome"` or `"prettier"`.
    * The formatter runs from `node_modules/.bin` of the project root, so your own formatter config
    * applies. If the binary is not installed, a warning is printed and the files are written
    * unformatted. `false`, the default, writes the files as they are rendered.
    */
   format?: "biome" | "prettier" | false;
   /**
    * Writes `hooks.react.ts` to `ipcDataDir`, next to `types.ts`: the React hooks `useIpcEvent(name,
    * callback)`, which subscribes to an `emit` channel and unsubscribes on unmount, and
    * `useIpcInvoke(name)`, which wraps an `invoke` channel in `invoke`, `data`, `error` and
    * `pending`. The hooks are written for the surface of no scope, and reach the API through the
    * global of `exposeAs`. The generated file imports `react`; the library does not depend on it.
    * `"vue"` is accepted, but writes no file yet. `false`, the default, writes no hooks.
    */
   hooks?: "react" | "vue" | false;
   /**
    * A module that exports the functions `serialize(value)` and `deserialize(wire)`, in the shape
    * of superjson: what `serialize` returns must be cloneable by Electron, and `deserialize` turns
    * it back into the value. The generated main and preload code apply them to the arguments and
    * the results of the channels between a page and the main process, so that a `Date`, a `Map` or a
    * class instance arrives as it was sent. A value that starts with `.` is a path relative to the
    * project root, and any other value is a package, such as `"superjson"`. Off by default.
    */
   serializer?: string;
}

/**
 * Gives the config of an `autoipc.config.ts` or `.mjs` file its type. It returns the config as it is.
 * The default export of a config file can also be a function (sync or async) that returns it.
 */
export function defineConfig(config: AutoIpcConfig): AutoIpcConfig;
