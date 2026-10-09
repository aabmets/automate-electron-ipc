import { defineChannels, invoke } from "automate-electron-ipc";

// The name of a channel which getPathForFile reserves, so the run fails and names this file.
export default defineChannels({
   getPathForFile: invoke<(name: string) => Promise<string>>(),
});
