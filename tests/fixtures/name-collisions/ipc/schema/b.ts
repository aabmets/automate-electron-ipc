import { defineChannels, invoke } from "automate-electron-ipc";
import type { Shared } from "../types/shared";
import type * as Models from "../types/two";

export interface User {
   name: string;
}

export default defineChannels({
   getUserB: invoke<() => Promise<User>>(),
   getItemB: invoke<() => Promise<Models.Item>>(),
   getSharedB: invoke<() => Promise<Shared>>(),
});
