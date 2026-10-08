import { defineChannels, emit, invoke, port, send } from "automate-electron-ipc";

export interface User {
   id: number;
   name: string;
}

export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>>(),
   echoUserName: send<(userName: string) => void>(),
   windowFocused: emit<(focused: boolean) => void>({ trigger: "focus" }),
   chatStream: port<(message: string) => void>(),
});
