import { defineChannels, invoke } from "automate-electron-ipc";
import type { Api } from "./types/api.v2.js";
import type { Legacy } from "./types/legacy.js";
import type { User } from "./types/user.model";

export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>>(),
   getApi: invoke<() => Promise<Api>>(),
   getLegacy: invoke<() => Promise<Legacy>>(),
});
