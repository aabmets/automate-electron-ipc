import { defineChannels, invoke, send } from "automate-electron-ipc";

export interface User {
   id: number;
   name: string;
}

export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>>(),
   renameUser: send<(id: number, name: string) => void>(),
});
