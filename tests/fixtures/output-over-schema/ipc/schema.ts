import { callUtility, defineChannels } from "automate-electron-ipc";

// utilityBindingsPath points at this file, which the run must not overwrite.
export default defineChannels({
   compute: callUtility<(a: number) => Promise<number>>(),
});
