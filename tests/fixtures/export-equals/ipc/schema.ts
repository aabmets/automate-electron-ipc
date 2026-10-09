import { defineChannels, invoke } from "automate-electron-ipc";

// The modules that these import have `export =`.
import Models = require("./models");
import User = require("./user");
export import Exported = require("./models");

export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>>(),
   getAccount: invoke<(id: number) => Promise<Models.Account>>(),
   getExported: invoke<(id: number) => Promise<Exported.Account>>(),
});
