import { defineChannels, invoke } from "automate-electron-ipc";
import type { Account } from "./models.mjs";

// A type imported from a .mts module, by its .mjs specifier.
export default defineChannels({
   getAccount: invoke<(id: number) => Promise<Account>>(),
});
