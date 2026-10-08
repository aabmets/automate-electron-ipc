import { defineChannels, emit, invoke, send } from "automate-electron-ipc";
import type { IpcMainEvent } from "./types/events";

// Names that the generated files declare or import themselves.
export interface BrowserWindow {
   title: string;
}
export interface Window {
   id: number;
}

export default defineChannels({
   getWindow: invoke<(id: number) => Promise<Window>>(),
   openWindow: send<(options: BrowserWindow) => void>(),
   eventHappened: emit<(event: IpcMainEvent) => void>({ trigger: "focus" }),
});
