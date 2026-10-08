import { defineChannels, emit, invoke, send } from "automate-electron-ipc";
import type { IpcMainEvent } from "./types/events";

// Names that the generated files declare or import themselves.
export interface BrowserWindow {
   title: string;
}
export interface Window {
   id: number;
}

export interface IpcApi {
   version: number;
}
export type ipc = { ready: boolean };
export type registeredHandlers = { count: number };

export default defineChannels({
   getApi: invoke<() => Promise<IpcApi>>(),
   getIpc: invoke<() => Promise<ipc>>(),
   getHandlers: invoke<() => Promise<registeredHandlers>>(),
   getWindow: invoke<(id: number) => Promise<Window>>(),
   openWindow: send<(options: BrowserWindow) => void>(),
   eventHappened: emit<(event: IpcMainEvent) => void>({ trigger: "focus" }),
});
