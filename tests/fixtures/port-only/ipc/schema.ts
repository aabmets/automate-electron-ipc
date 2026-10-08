import { defineChannels, port } from "automate-electron-ipc";

export default defineChannels({
   chat: port<(msg: string) => void>(),
});
