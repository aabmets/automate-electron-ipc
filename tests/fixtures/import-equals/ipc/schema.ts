import { defineChannels, invoke } from "automate-electron-ipc";
import * as Models from "./models";

// An alias declared by import-equals, which signatures use as any other type.
export import User = Models.User;

export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>>(),
});
