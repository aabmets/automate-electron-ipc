import { ask, defineChannels } from "automate-electron-ipc";

export default defineChannels({
   hasUnsavedChanges: ask<(documentId: number) => boolean>(),
});
