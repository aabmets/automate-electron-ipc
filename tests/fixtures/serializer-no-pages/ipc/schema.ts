import { defineChannels, port } from "automate-electron-ipc";

// Two pages talk over this channel and the main process only pairs them, so it sees none of the
// messages and has nothing to do with the serializer. Every other kind of channel has a message that
// the main process reads or writes.
export default defineChannels({
   tracker: port<(at: Date) => void>(),
});
