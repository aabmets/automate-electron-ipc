import { defineChannels, invoke, send, stream } from "automate-electron-ipc";

export default defineChannels({
   // Open to all windows.
   getVersion: invoke<() => Promise<string>>(),
   note: send<(text: string) => void>(),
   // The settings window only.
   getSettings: invoke<() => Promise<string>>({ scopes: ["settings"] }),
   // The settings window, and only the page at app://main.
   vault: invoke<() => Promise<string>>({ scopes: ["settings"], allowedOrigins: ["app://main"] }),
   // The editor window only.
   openFile: invoke<(path: string) => Promise<string>>({ scopes: ["editor"] }),
   exportRows: stream<() => AsyncIterable<number>>({ scopes: ["editor"] }),
   // Both of them.
   audit: send<(text: string) => void>({ scopes: ["settings", "editor"] }),
});
