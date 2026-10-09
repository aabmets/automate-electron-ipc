import { ask, defineChannels, emit, invoke, port, send, stream } from "automate-electron-ipc";

export interface Settings {
   theme: string;
}

export interface Document {
   path: string;
   text: string;
}

export default defineChannels({
   // Open to all windows, also to the ones that are in no scope.
   getVersion: invoke<() => Promise<string>>(),
   log: send<(text: string) => void>(),
   // The settings window only.
   getSettings: invoke<() => Promise<Settings>>({ scopes: ["settings"] }),
   saveSettings: invoke<(settings: Settings) => Promise<void>>({ scopes: ["settings"] }),
   // The settings window, and only from the origin of the app.
   vault: invoke<() => Promise<string>>({ scopes: ["settings"], allowedOrigins: ["app://."] }),
   themeChanged: emit<(theme: string) => void>({ scopes: ["settings"] }),
   // The editor window only.
   openFile: invoke<(path: string) => Promise<Document>>({ scopes: ["editor"] }),
   exportRows: stream<(table: string) => AsyncIterable<number>>({ scopes: ["editor"] }),
   hasUnsavedChanges: ask<() => boolean>({ scopes: ["editor"] }),
   chat: port<(msg: string) => void>({ scopes: ["editor"] }),
   // Both of them, but no other window.
   notify: send<(text: string) => void>({ scopes: ["settings", "editor"] }),
});
