import { defineChannels, emit, invoke, port, send } from "automate-electron-ipc";

export default defineChannels({
   getUser: invoke<(id: number) => Promise<string>>(),
   logLine: send<(text: string) => void>(),
   progress: emit<(percent: number) => void>(),
   chat: port<(msg: string) => void>(),
});
