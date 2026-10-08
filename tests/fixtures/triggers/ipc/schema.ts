import { defineChannels, emit } from "automate-electron-ipc";

export default defineChannels({
   windowFocused: emit<(focused: boolean) => void>({ trigger: "focus" }),
   titleChanged: emit<(title: string, ...tags: string[]) => void>({
      trigger: "page-title-updated",
   }),
   plain: emit<(n: number) => void>(),
});
