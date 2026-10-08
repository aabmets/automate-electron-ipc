import { defineChannels, invoke, send } from "automate-electron-ipc";

export default defineChannels({
   getUser: invoke<(id: number) => Promise<string>>(),
   echo: send<(text: string, ...rest: number[]) => void>(),
   ping: send<(text: string) => Promise<void>>(),
});
