import { defineChannels, invoke } from "automate-electron-ipc";

export interface User {
   id: number;
}

// A schema file of its own with the .mts extension.
export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>>(),
});
