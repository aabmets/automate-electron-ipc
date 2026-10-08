import { defineChannels, invoke } from "automate-electron-ipc";

export interface User {
   email: string;
}

export default defineChannels({
   getUserC: invoke<() => Promise<User>>(),
});
