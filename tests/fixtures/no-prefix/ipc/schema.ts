import { defineChannels, emit, invoke, port, send } from "automate-electron-ipc";

export default defineChannels({
   getUser: invoke<(id: number) => Promise<string>>(),
   getTime: invoke<() => Promise<number>>(),
   logLine: send<(text: string, ...rest: number[]) => void>(),
   titleChanged: emit<(title: string) => void>({ trigger: "page-title-updated" }),
   progress: emit<(percent: number, label?: string) => void>(),
   chat: port<(msg: string) => void>(),
});
