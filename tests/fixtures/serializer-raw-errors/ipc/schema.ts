import { defineChannels, invoke, send } from "automate-electron-ipc";

export default defineChannels({
   nextDay: invoke<(since: Date) => Promise<Date>>(),
   stamp: send<(at: Date) => void>(),
});
