// biome-ignore-all lint/style/noNamespace: the fixture needs a namespace to alias into
import { defineChannels, invoke } from "automate-electron-ipc";
import * as Models from "./models";

// Aliases declared inside a namespace body, exported and not exported.
export namespace Api {
   export import User = Models.User;
   import Account = Models.Account;

   export interface Reply {
      user: User;
      account: Account;
   }
}

export default defineChannels({
   getReply: invoke<(id: number) => Promise<Api.Reply>>(),
   getUser: invoke<(id: number) => Promise<Api.User>>(),
});
