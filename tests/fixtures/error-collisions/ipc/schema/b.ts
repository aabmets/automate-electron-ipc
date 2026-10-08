import { defineChannels, invoke } from "automate-electron-ipc";
import type { Conflict } from "../errors/two";

export default defineChannels({
   saveB: invoke<() => Promise<void>, Conflict>(),
});
