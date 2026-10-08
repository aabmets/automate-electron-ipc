import { defineChannels, invoke, send } from "automate-electron-ipc";

export default defineChannels({
   getUser: invoke<(id: number) => Promise<string>>(),
   getPlain: invoke<() => number>(),
   deleteUser: invoke<(id: number) => void>(),
   ping: send<() => void>(),
});
