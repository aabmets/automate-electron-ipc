import { defineChannels, invoke } from "automate-electron-ipc";
import type { Zeta } from "../types/zeta";

export default defineChannels({
   getZeta: invoke<() => Promise<Zeta>>(),
});
