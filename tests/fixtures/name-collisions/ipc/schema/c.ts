import { defineChannels, emit, invoke } from "automate-electron-ipc";

export interface User {
   email: string;
}

export default defineChannels({
   getUserC: invoke<() => Promise<User>>(),
   // A renamed type before the parameter list moves the start of the list.
   findUserC: invoke<<T extends User>(user: T) => Promise<T>>(),
   pushUserC: emit<<T extends User>(user: T) => void>(),
});
