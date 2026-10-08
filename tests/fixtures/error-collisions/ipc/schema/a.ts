import { defineChannels, invoke } from "automate-electron-ipc";
import type { Conflict, Ok } from "../errors/one";

// `Conflict` of this file is not the one of the other schema file.
export default defineChannels({
   saveA: invoke<() => Promise<void>, Conflict | Ok>(),
});
