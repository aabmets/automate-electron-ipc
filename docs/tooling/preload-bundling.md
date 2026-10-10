# Preload bundling and the sandbox

A window with `sandbox: true` (the default since Electron 20) runs its preload script with a small,
polyfilled `require`. It can load `electron` (only `contextBridge`, `crashReporter`, `ipcRenderer`,
`nativeImage`, `webFrame` and `webUtils`), `events`, `timers` and `url`, and nothing else: not a local
file, not a package from `node_modules`, and not an ES module. Electron also does not load TypeScript.
So the script that a window loads has to be one compiled, single CommonJS file, and `preload.ts` gets
there through your bundler: build it as the entry of the preload build, or import it from your own
preload entry.

## What the generated preload imports

`contextBridge` and `ipcRenderer` from `electron`, and
`webUtils` too with `getPathForFile`. All of them are available in a sandboxed preload script. The
generated code has no other import at run time (type-only imports are erased), and none from this library. The one exception is the module of the
[`serializer`](../schema/custom-serializers.md), which `preload.ts` imports when the schema has channels that it
applies to. The bundler must inline that module, so keep it out of what the build leaves external. In
electron-vite the config of the template externalizes the dependencies of the preload build, so add
the serializer package to the `exclude` of its `externalizeDepsPlugin`. Without a serializer, the compiled script
has a single `require("electron")`, and works as it is.

## Format

A sandboxed preload script cannot be an ES module, because Electron loads ES module
preload scripts only for windows with `sandbox: false`. Check that your build emits CommonJS for the
preload entry, and point `preload` of the window at that file. electron-vite builds CommonJS for the preload
by default; if your `package.json` has `"type": "module"`, the preload build may emit an ES module
(`.mjs`), which only an unsandboxed window can load, so set the output format of that build to `cjs`. Keep `sandbox: true` and
`contextIsolation: true` on the windows that show anything but your own pages. The generated
`preload.ts` was written for them, and the [tests that run in Electron](../contributing/index.md) use them.
For the tsconfig of the preload code, see [TypeScript configuration](typescript-configuration.md).

## `autoExpose`: let the file expose the API, or do it yourself

`preload.ts` exports the API it builds,
and a function that exposes it:

```ts
export const api = { /* one object per channel */ };
export function expose(key = "ipc"): void { /* contextBridge.exposeInMainWorld(key, api) */ }
expose();   // only with "autoExpose": true, the default
```

By default the file calls `expose()` itself when it loads, so it can be the preload script of a window,
or it can be imported by your own preload entry that does other things as well. A preload entry
that has its own API needs only the import, since the import runs `expose()`:

```ts
// src/preload/index.ts
import { contextBridge } from "electron";
import "../autoipc/preload";   // exposes `ipc`

contextBridge.exposeInMainWorld("platform", { name: process.platform });
```

With `"autoExpose": false` nothing is exposed while the file loads, and your own preload code
decides what happens. This is for an entry that must run code before the page can see the API, that
wants another key, or that uses the API in the preload script itself:

<!-- readme-example: preload-compose package.json -->
```json
{
   "config": {
      "autoipc": {
         "ipcDataDir": "src/autoipc",
         "autoExpose": false
      }
   }
}
```

<!-- readme-example: preload-compose src/autoipc/schema.ts -->
```ts
import { defineChannels, send } from "automate-electron-ipc";

export default defineChannels({
   logLine: send<(line: string) => void>(),
});
```

<!-- readme-example: preload-compose src/preload/index.ts -->
```ts
import { api, expose } from "../autoipc/preload";

api.logLine.send("The preload script is running");   // use the API in the preload script itself
expose();                // under the configured key, `exposeAs`
expose("legacyIpc");     // under another key
```

The default key of `expose` is `exposeAs`. Every call exposes the same `api` object, so the state of
the channels (listeners, ports, streams) is shared between the keys. Only the key that `window.d.ts`
declares (`exposeAs`) is typed for the page.

## `isolatedWorldId`: expose the API to an isolated world

By default `expose` uses
`contextBridge.exposeInMainWorld`, so the API is a global of the page. With `isolatedWorldId` set,
`expose` uses `contextBridge.exposeInIsolatedWorld(isolatedWorldId, key, api)`: the page does not see
the API, and only code that runs in that world does, such as a script that the preload script runs with
`webFrame.executeJavaScriptInIsolatedWorld`. Electron's own worlds have the ids below 1000 (`999` is the
one of `contextIsolation`), so the config accepts 1000 up to 2147483647. `window.d.ts` still declares
the global, with a comment that only that world has it. The generated code only exposes the API in the world: your own code decides what runs there.
