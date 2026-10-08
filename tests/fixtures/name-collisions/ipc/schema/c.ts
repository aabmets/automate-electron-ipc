import { defineChannels, emit, invoke, send } from "automate-electron-ipc";

export interface User {
   email: string;
}

export default defineChannels({
   getUserC: invoke<() => Promise<User>>(),
   // A renamed type before the parameter list moves the start of the list.
   findUserC: invoke<<T extends User>(user: T) => Promise<T>>(),
   pushUserC: emit<<T extends User>(user: T) => void>(),
   // The renamed type is also used inside a template literal type, and a method has its name.
   tagUserC:
      invoke<(tag: `user-${User["email"]}`, shape: { User(): User }) => Promise<User["email"]>>(),
   // A space inside `Promise< void >` does not change the type.
   // biome-ignore format: the spaces are the point of this channel
   notifyC: send<(user: User) => Promise< void >>(),
});
