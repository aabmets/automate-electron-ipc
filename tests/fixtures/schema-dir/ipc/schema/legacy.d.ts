import { defineChannels, invoke } from "automate-electron-ipc";

// A declaration file is not a schema source, so this duplicate channel must be ignored.
export default defineChannels({
   getUser: invoke<(id: number) => Promise<string>>(),
});
