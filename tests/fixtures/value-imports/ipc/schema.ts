import { defineChannels, emit, invoke, send } from "automate-electron-ipc";
import { Rectangle } from "electron";
import Profile, { Avatar as Picture } from "./types/profile";
import { Mode, Settings } from "./types/settings";

export default defineChannels({
   getSettings: invoke<() => Promise<Settings>>(),
   setMode: send<(mode: Mode) => void>(),
   getProfile: invoke<(id: number) => Promise<Profile>>(),
   setPicture: send<(picture: Picture) => void>(),
   boundsChanged: emit<(bounds: Rectangle) => void>({ trigger: "resize" }),
});
