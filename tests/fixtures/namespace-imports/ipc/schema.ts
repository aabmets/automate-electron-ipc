import { defineChannels, invoke, send } from "automate-electron-ipc";
import type * as Models from "./types/models";

export default defineChannels({
   getAccount: invoke<(id: number) => Promise<Models.Account>>(),
   setSession: send<(session: Models.Session) => void>(),
});
