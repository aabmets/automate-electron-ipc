import { defineChannels, emit, invoke, send } from "automate-electron-ipc";

export default defineChannels({
   getSecret: invoke<(id: number) => Promise<string>>({
      allowedOrigins: ["app://.", "http://localhost:5173"],
   }),
   getPublic: invoke<() => Promise<number>>(),
   logLine: send<(text: string) => void>({ allowedOrigins: ["app://."] }),
   ping: send<() => void>(),
   progress: emit<(percent: number) => void>(),
});
