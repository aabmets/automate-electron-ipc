import { defineChannels, emit, invoke, send } from "automate-electron-ipc";

export default defineChannels({
   getUser: invoke<(id: number) => Promise<string>>(),
   logLine: send<(text: string) => void>(),
   progress: emit<(percent: number) => void>(),
});
