import { defineChannels, invokeUtility } from "automate-electron-ipc";

export default defineChannels({
   queryRows: invokeUtility<(sql: string) => Promise<string[]>>(),
});
