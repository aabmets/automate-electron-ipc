import { defineChannels, invoke } from "automate-electron-ipc";

// The require form of import-equals: one alias is exported, the other is not.
import Models = require("./models");
export import Exported = require("./models");

export default defineChannels({
   getUser: invoke<(id: number) => Promise<Models.User>>(),
   getAccount: invoke<(id: number) => Promise<Exported.Account>>(),
});
