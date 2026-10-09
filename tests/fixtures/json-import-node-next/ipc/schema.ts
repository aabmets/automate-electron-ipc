import { defineChannels, send } from "automate-electron-ipc";
import settings from "./settings.json" with { type: "json" };

// A JSON module keeps its specifier under NodeNext: it gets no script extension.
export default defineChannels({
   save: send<(value: typeof settings) => void>(),
});
