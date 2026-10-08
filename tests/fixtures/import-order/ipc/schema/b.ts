import { defineChannels, invoke } from "automate-electron-ipc";
import type { Alpha } from "../types/alpha";

export default defineChannels({
   getAlpha: invoke<() => Promise<Alpha>>(),
});
