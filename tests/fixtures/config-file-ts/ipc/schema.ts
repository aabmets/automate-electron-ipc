import { defineChannels, invoke } from "automate-electron-ipc";

export default defineChannels({
   getUser: invoke<(id: number) => Promise<string>>(),
});
