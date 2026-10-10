# Quickstart

This walk-through sets up one request from a page to the main process, and one message the other way.

**1. Run `ipcgen` once.** It finds no schema, so it creates the IPC data directory (`src/autoipc` by
default) and prints a warning that names the path where the schema belongs. Do not let this warning
dissuade you: its purpose is to guide you where to create the schema file or directory, which holds the
channel expressions that IPC automation parses.

```bash
npx ipcgen
```

**2. Write the schema.** By default, IPC automation looks for a file named `schema.ts` in the IPC data
directory. If you create a directory named `schema` into the IPC data directory instead, IPC automation
recursively parses all files within it for channel maps, so it is possible to structure and segment
channels according to the needs of larger applications. Each channel has a name, a verb (the kind of the
channel) and a signature; see [Channel Maps](channel-maps.md) and [Verbs](../schema/verbs.md).

<!-- readme-example: getting-started src/autoipc/schema.ts -->
```ts
import { defineChannels, invoke, send } from "automate-electron-ipc";

export default defineChannels({
   // The page asks, the main process answers.
   getVersion: invoke<() => string>(),
   // The page tells the main process something, and gets no answer.
   logLine: send<(line: string) => void>(),
});
```

**3. Run `ipcgen` again.** It writes `main.ts`, `preload.ts`, `window.d.ts` and `types.ts` next to the
schema (see [Generated files](../tooling/generated-files.md)). Run it again whenever the schema changes, or keep
`ipcgen --watch` running, or use the [Vite plugin](../tooling/vite.md).

**4. Use the bindings in the main process.** `ipc` is the object of the main process, with one member per
channel:

<!-- readme-example: getting-started src/main/index.ts -->
```ts
import { app } from "electron";
import { ipc } from "../autoipc/main";

app.whenReady().then(() => {
   ipc.getVersion.handle(() => app.getVersion());
   ipc.logLine.on((_event, line) => console.log(line));
});
```

**5. Load the preload script.** The generated `preload.ts` is the preload script of your windows. It
exposes the API to the page as `window.ipc`. A sandboxed window loads a compiled script, so build `preload.ts`
with your bundler, or import it from your own preload entry; see
[Preload bundling and the sandbox](../tooling/preload-bundling.md).

**6. Call the API from the page.** The typings in `window.d.ts` declare `ipc` as a global variable:

<!-- readme-example: getting-started src/renderer/app.ts -->
```ts
async function showVersion(): Promise<void> {
   ipc.logLine.send("Asking for the version");
   const version: string = await ipc.getVersion.invoke();
   document.title = `Version ${version}`;
}

showVersion();
```

Finally, make sure that your `tsconfig.json` files include the generated ones; see
[TypeScript configuration](../tooling/typescript-configuration.md).
Using electron-vite? [electron-vite end to end](../tooling/electron-vite.md) is this walk-through for its
project layout.
