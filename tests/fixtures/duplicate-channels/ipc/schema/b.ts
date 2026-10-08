import { defineChannels, invoke } from "automate-electron-ipc";

export default defineChannels({
   getUser: invoke<(name: string) => Promise<number>>(),
});
