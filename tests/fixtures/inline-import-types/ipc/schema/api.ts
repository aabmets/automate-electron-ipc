import { defineChannels, invoke } from "automate-electron-ipc";

// An import type, whose path is relative to this file and not to the generated ones.
export default defineChannels({
   getUser: invoke<(id: number) => Promise<import("./models").User>>(),
});
