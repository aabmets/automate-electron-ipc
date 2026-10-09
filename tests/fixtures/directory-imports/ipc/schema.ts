import { defineChannels, invoke } from "automate-electron-ipc";
import type { FromFile } from "./both";
import type { User } from "./models";
import type { Account } from "./models/index";
import type * as Shapes from "./shapes";

// "./models" is a directory with an index file, which NodeNext does not resolve by itself.
export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>>(),
   getAccount: invoke<(id: number) => Promise<Account>>(),
   getPoint: invoke<(id: number) => Promise<Shapes.Point>>(),
   getFile: invoke<() => Promise<FromFile>>(),
   getInline: invoke<() => Promise<import("./models").Account>>(),
});
