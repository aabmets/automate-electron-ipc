# Quickstart

This walk-through sets up two channels from a page to the main process: a request that the main process
answers, and a message that needs no answer. It starts from a project that has `automate-electron-ipc`
installed (see [Installation](installation.md)).

**1. Run `ipcgen` once.** It finds no schema, so it creates the IPC data directory (`src/autoipc` by
default) and prints a warning that names the path where the schema belongs. Do not let this warning
dissuade you: its purpose is to guide you where to create the schema file or directory, which holds the
channel maps that IPC automation parses.

```bash
npx ipcgen
```

```text
⚠️ – Skipping IPC automation, because schema path does not exist:
     /home/me/app/src/autoipc/schema.ts
```

**2. Write the schema.** By default, IPC automation looks for a file named `schema.ts` in the IPC data
directory. If you create a directory named `schema` in the IPC data directory instead, IPC automation
recursively parses all files within it for channel maps, so it is possible to structure and segment
channels according to the needs of larger applications. Each channel has a name, a verb (the kind of the
channel) and a signature; see [Channel maps](channel-maps.md) and [Verbs](../schema/verbs.md).

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
schema (see [Generated files](../tooling/generated-files.md)):

```text
✔ – Successfully generated IPC bindings:
     2 channels from path 'src/autoipc/schema.ts'
```

Run it again whenever the schema changes, or keep `ipcgen --watch` running, or use the
[Vite plugin](../tooling/vite.md).

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
exposes the API to the page as `window.ipc` (the name is the `exposeAs` option of the
[configuration](../tooling/configuration.md)). A sandboxed window loads a compiled script, so build
`preload.ts` with your bundler, or import it from your own preload entry; see
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

## Next steps

- [Verbs](../schema/verbs.md) lists everything a schema can declare, from `invoke` and `send` to streams, ports,
  utility processes and service workers.
- [Security](../security/index.md) shows how to restrict who may call a channel and how to validate arguments.
- If you are upgrading a 0.2 project, start with [Migrating from 0.2.x](../migration/index.md).
