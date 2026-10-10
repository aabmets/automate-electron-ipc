# electron-vite end to end

This walk-through takes the project that `npm create @quick-start/electron` makes (the vanilla
TypeScript template; the React and Vue ones differ in the renderer only) and gives it a typed IPC with
one request, and one message from the main process to the page. The layout, with the files that you
write marked:

```text
my-app/
├── electron.vite.config.ts      ← the plugin goes in
├── package.json
├── tsconfig.json
├── tsconfig.node.json           ← include the generated files of the main process and the preload script
├── tsconfig.web.json            ← include the generated files of the page
└── src/
    ├── autoipc/
    │   ├── schema.ts            ← you write this one
    │   └── main.ts, preload.ts, window.d.ts, types.ts   ← generated
    ├── main/index.ts            ← the main process
    ├── preload/index.ts         ← the preload entry
    └── renderer/
        ├── index.html
        └── src/main.ts          ← the page
```

**1. Add the plugin to the three builds.** electron-vite starts the main, preload and renderer builds
in one process, and the plugin generates the bindings once at the start of them, and again when the
schema changes in the dev server (see [Vite and electron-vite](vite.md)):

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

The config of the template has more in it, such as the `externalizeDepsPlugin` and the alias of the
renderer; leave that as it is and add `autoipc()` to `plugins`. This file is shown, but the docs examples test
does not type-check it, since that would need the `electron-vite` package.

**2. Write the schema.** The default `ipcDataDir` is `src/autoipc`, which is next to the folders of the
template:

<!-- readme-example: electron-vite src/autoipc/schema.ts -->
```ts
import { defineChannels, emit, invoke } from "automate-electron-ipc";

export default defineChannels({
   // The page asks, the main process answers.
   getVersion: invoke<() => string>(),
   // The main process tells every window when the theme of the system changes.
   themeChanged: emit<(theme: "light" | "dark") => void>(),
});
```

**3. Wire up the main process.** The window must load the compiled preload script, and the handlers
come from `ipc`:

<!-- readme-example: electron-vite src/main/index.ts -->
```ts
import { join } from "node:path";
import { app, BrowserWindow, nativeTheme } from "electron";
import { ipc } from "../autoipc/main";

function createWindow(): BrowserWindow {
   const window = new BrowserWindow({
      webPreferences: {
         // The output of the preload build, which electron-vite writes next to the main build.
         preload: join(__dirname, "../preload/index.js"),
         sandbox: true,
         contextIsolation: true,
      },
   });
   if (process.env.ELECTRON_RENDERER_URL) {
      window.loadURL(process.env.ELECTRON_RENDERER_URL);   // the dev server
   } else {
      window.loadFile(join(__dirname, "../renderer/index.html"));
   }
   return window;
}

app.whenReady().then(() => {
   ipc.getVersion.handle(() => app.getVersion());
   nativeTheme.on("updated", () => {
      ipc.themeChanged.broadcast(nativeTheme.shouldUseDarkColors ? "dark" : "light");
   });
   createWindow();
});
```

**4. Write the preload entry.** electron-vite bundles `src/preload/index.ts` into the script above,
with the generated file inlined (see [Preload bundling and the sandbox](preload-bundling.md)).
The entry is one line, since the generated file exposes `window.ipc` when it loads:

<!-- readme-example: electron-vite src/preload/index.ts -->
```ts
import "../autoipc/preload";
```

**5. Call the API from the page.** `window.d.ts` declares `ipc` as a global, so the page needs no import:

<!-- readme-example: electron-vite src/renderer/src/main.ts -->
```ts
const versionLabel = document.querySelector<HTMLElement>("#version");

async function showVersion(): Promise<void> {
   const version: string = await ipc.getVersion.invoke();
   if (versionLabel) {
      versionLabel.textContent = `Version ${version}`;
   }
}

// `on` returns a function which removes the listener again.
const stopListening = ipc.themeChanged.on((theme) => {
   document.documentElement.dataset.theme = theme;
});

showVersion();
```

**6. Include the generated files in the tsconfigs.** The `include` lists of the template do not reach
`src/autoipc`: see [TypeScript configuration](typescript-configuration.md) for the lists of
`tsconfig.node.json` and `tsconfig.web.json`.

**7. Run it.** `npm run dev` generates the files and starts the app with hot reload, and `npm run build`
generates them before it builds. A build in CI should not rewrite files that are checked in, so add
`ipcgen --check` to the checks that run before it (see [Command line](command-line.md)).
