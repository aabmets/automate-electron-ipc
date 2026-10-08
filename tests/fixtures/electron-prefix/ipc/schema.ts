import { defineChannels, emit, invoke, send } from "automate-electron-ipc";

export default defineChannels({
   getValue: invoke<(id: number) => Promise<string>>(),
   log: send<(text: string) => void>(),
   notice: emit<(text: string) => void>(),
});
