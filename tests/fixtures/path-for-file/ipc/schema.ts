import { defineChannels, invoke } from "automate-electron-ipc";

export default defineChannels({
   upload: invoke<(path: string, name: string) => Promise<boolean>>(),
});
