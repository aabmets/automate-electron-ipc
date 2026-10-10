# Putting it together

This page shows a complete setup with two windows: scopes decide which window has which channel, origins limit the callers, and validators check the arguments before a handler runs.

## The example

A schema with an editor window and a settings window. Every `invoke` is limited to the pages of the app, the settings window is the only one that can save settings, and the arguments are checked before a handler runs. The validators are written by hand here, so that the example needs no library; with zod, `saveSettingsArgs` is `z.tuple([z.enum(["light", "dark"])])`.

<!-- readme-example: security-guide src/autoipc/schema.ts -->
```ts
import { defineChannels, emit, invoke } from "automate-electron-ipc";
import { openFileArgs, saveSettingsArgs } from "./validators";

export default defineChannels({
   // Every window may ask, but only a page of the app itself.
   getVersion: invoke<() => string>({ allowedOrigins: ["app://."] }),
   // The settings window only, and the argument has to be one of two strings.
   saveSettings: invoke<(theme: "light" | "dark") => Promise<void>>({
      scopes: ["settings"],
      allowedOrigins: ["app://."],
      validate: saveSettingsArgs,
   }),
   // The editor window only.
   openFile: invoke<(file: string) => Promise<string>>({
      scopes: ["editor"],
      allowedOrigins: ["app://."],
      validate: openFileArgs,
   }),
   // The editor hears when the theme changes.
   themeChanged: emit<(theme: "light" | "dark") => void>({ scopes: ["editor"] }),
});
```

<!-- readme-example: security-guide src/autoipc/validators.ts -->
```ts
import type { StandardSchemaV1 } from "automate-electron-ipc";

/** A Standard Schema of an argument tuple: any library that implements the interface works. */
function tuple<T extends unknown[]>(
   accepts: (args: unknown[]) => boolean,
   message: string,
): StandardSchemaV1<unknown, T> {
   return {
      "~standard": {
         version: 1,
         vendor: "readme",
         validate: (value) =>
            Array.isArray(value) && accepts(value)
               ? { value: value as T }
               : { issues: [{ message }] },
      },
   };
}

export const saveSettingsArgs = tuple<[theme: "light" | "dark"]>(
   (args) => args.length === 1 && (args[0] === "light" || args[0] === "dark"),
   "expected the theme 'light' or 'dark'",
);

export const openFileArgs = tuple<[file: string]>(
   (args) => args.length === 1 && typeof args[0] === "string" && args[0].length <= 255,
   "expected a file name of at most 255 characters",
);
```


## The main process

The main process registers each window in its scope, sets the rules that need code, and still decides in the handler what a valid call may do. A well-formed `file` is not a permitted one:

<!-- readme-example: security-guide src/main/index.ts -->
```ts
import { app, BrowserWindow } from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { configureIpc, ipc, registerScope } from "../autoipc/main";

function createWindow(scope: "settings" | "editor", preload: string): BrowserWindow {
   const window = new BrowserWindow({
      webPreferences: { preload, sandbox: true, contextIsolation: true },
   });
   registerScope(window, scope);
   return window;
}

app.whenReady().then(() => {
   configureIpc({
      // Only the top frame of a window may call, not an iframe in it.
      validateSender: (event) => event.senderFrame?.parent === null,
      onRejected: (event, channel) => {
         console.warn("Rejected a call of", channel, "from", event.senderFrame?.url);
      },
   });

   const settings = createWindow("settings", path.join(__dirname, "preload.settings.js"));
   const editor = createWindow("editor", path.join(__dirname, "preload.editor.js"));

   const documents = app.getPath("documents");

   ipc.getVersion.handle(() => app.getVersion());
   ipc.saveSettings.handle(async (_event, theme) => {
      if (!editor.isDestroyed()) {
         ipc.themeChanged.send(editor, theme);
      }
   });
   ipc.openFile.handle((_event, file) => {
      // The schema has checked the shape of `file`. Whether the page may read it is for the handler.
      const resolved = path.resolve(documents, file);
      if (!resolved.startsWith(documents + path.sep)) {
         throw new Error("That file is outside of the documents folder");
      }
      return readFile(resolved, "utf8");
   });
});
```

## What each part does

- `scopes` gives `settings` and `editor` their own preload scripts and declaration files. `registerScope` makes the main process enforce it, so a compromised page cannot call the other window's channels. See [Scopes](scopes.md).
- `allowedOrigins` limits every `invoke` to pages served from `app://.`. See [Sender validation](sender-validation.md).
- `validateSender` in `configureIpc` also requires the top frame, so an iframe in a window is rejected, and `onRejected` logs what was turned away.
- `validate` runs the schema on the arguments before the handler. See [Validating arguments](validating-arguments.md).
- The check on `resolved` in `openFile` is the handler's own: nothing in the library knows which files a page may read.
