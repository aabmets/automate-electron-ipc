import { defineChannels, invoke } from "automate-electron-ipc";

// A schema type named like the global `Error`, which the generated error type refers to.
export interface Error {
   reason: string;
}

export default defineChannels({
   saveC: invoke<(error: Error) => Promise<void>>(),
});
