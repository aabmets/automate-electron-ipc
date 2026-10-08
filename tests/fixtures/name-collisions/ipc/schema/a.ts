import { defineChannels, invoke } from "automate-electron-ipc";
import type * as Models from "../types/one";
import type { Shared } from "../types/shared";
import type { User } from "../types/user";

// `User` and `Models` of this file differ from the ones of the other schema files.
export default defineChannels({
   getUserA: invoke<(id: number) => Promise<User>>(),
   getItemA: invoke<() => Promise<Models.Item>>(),
   getSharedA: invoke<(shared: Shared) => Promise<Shared>>(),
});
