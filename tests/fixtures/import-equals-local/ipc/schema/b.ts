import { defineChannels, invoke } from "automate-electron-ipc";
import * as Models from "../types/other";

// `Models` is another module here, so the generated files import it under another name.
import User = Models.User;

export default defineChannels({
   getName: invoke<(id: number) => Promise<User>>(),
});
