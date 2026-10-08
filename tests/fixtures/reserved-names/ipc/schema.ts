import { ask, defineChannels, emit, invoke, send } from "automate-electron-ipc";
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

export interface WebContents {
   url: string;
}
export type broadcastMessage = { sent: number };
export type resolveSendTarget = { found: boolean };
export interface WebFrameMain {
   frameId: number;
}
export type sendToSenderFrame = { delivered: boolean };

// Names that the generated code of the ask channels declares or uses.
export interface IpcAskError {
   reason: string;
}
export interface IpcAskOptions {
   retries: number;
}
export type askRenderer = { asked: boolean };
export type PendingAsk = { id: number };
export type Awaited = { value: number };

export default defineChannels({
   getApi: invoke<() => Promise<IpcApi>>(),
   getIpc: invoke<() => Promise<ipc>>(),
   getHandlers: invoke<() => Promise<registeredHandlers>>(),
   getWindow: invoke<(id: number) => Promise<Window>>(),
   openWindow: send<(options: BrowserWindow) => void>(),
   pageChanged: emit<(contents: WebContents, sent: broadcastMessage) => void>(),
   frameReplied: emit<(frame: WebFrameMain, delivered: sendToSenderFrame) => void>(),
   targetResolved: emit<(found: resolveSendTarget) => void>(),
   askError: ask<(options: IpcAskOptions) => IpcAskError>(),
   askWho: ask<() => Promise<askRenderer>>(),
   askPending: ask<(pending: PendingAsk) => Awaited>(),
   eventHappened: emit<(event: IpcMainEvent) => void>({ trigger: "focus" }),
});
