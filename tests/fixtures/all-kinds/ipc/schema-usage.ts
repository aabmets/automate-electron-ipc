// Not a schema: it uses the generated bindings the way an application would,
// so that the type-check fails when a channel exposes the wrong methods.
import type {
   BrowserWindow,
   IpcMainEvent,
   IpcMainInvokeEvent,
   WebContents,
   WebContentsView,
   WebFrameMain,
} from "electron";
import { ipc as mainIpc } from "./main";

declare const win: BrowserWindow;
declare const contents: WebContents;
declare const view: WebContentsView;
declare const frame: WebFrameMain;
declare const event: IpcMainEvent;
declare const invokeEvent: IpcMainInvokeEvent;

// Renderer: the bare global, `window.ipc` and `globalThis.ipc` are the same typed object.
export const user: Promise<string> = ipc.getUser.invoke(1);
export const userViaWindow: Promise<string> = window.ipc.getUser.invoke(1);
export const userViaGlobalThis: Promise<string> = globalThis.ipc.getUser.invoke(1);
ipc.logLine.send("line", 1, 2);
ipc.progress.on((percent: number, label?: string) => console.log(percent, label));
export const stopProgress: () => void = ipc.progress.on(() => undefined);
export const stopProgressOnce: () => void = ipc.progress.once((percent: number) => percent);
stopProgress();
ipc.chat.send("hi");
export const stopChat: () => void = ipc.chat.on((msg: string) => console.log(msg));
export const stopReady: () => void = ipc.chat.onReady(() => ipc.chat.send("ready"));
export const stopClose: () => void = ipc.chat.onClose(() => undefined);
// @ts-expect-error the callback of onReady takes no arguments
ipc.chat.onReady((msg: string) => msg);
// @ts-expect-error a port channel has no close, the main process closes the connection
ipc.chat.close();

// Renderer: each verb allows only its own methods.
// @ts-expect-error invoke channels cannot be sent or listened to
ipc.getUser.send(1);
// @ts-expect-error invoke channels cannot be sent or listened to
ipc.getUser.on(() => undefined);
// @ts-expect-error send channels cannot be invoked
ipc.logLine.invoke("line");
// @ts-expect-error emit channels are only listened to in the renderer
ipc.progress.send(1);
// @ts-expect-error emit channels are only listened to in the renderer
ipc.progress.invoke(1);
// @ts-expect-error port channels are connected by the main process
ipc.chat.connect(win, win);
// @ts-expect-error the 0.2 names no longer exist
window.ipc.sendGetUser(1);
// @ts-expect-error the 0.2 names no longer exist
window.ipc.ports.chat.sendMessage("hi");

// Main: each verb allows only its own methods.
mainIpc.getUser.handle(async (_event, id: number) => `user ${id}`);
mainIpc.logLine.on((_event, text: string, ...rest: number[]) => console.log(text, rest));
export const stopLogLine: () => void = mainIpc.logLine.on(() => undefined);
export const stopLogLineOnce: () => void = mainIpc.logLine.once((_event, text: string) => text);
export const stopGetUser: () => void = mainIpc.getUser.handle(async () => "user");
export const stopGetUserOnce: () => void = mainIpc.getUser.handleOnce(async () => "user");
stopLogLine();
mainIpc.progress.send(win, 50, "half");
mainIpc.progress.send(contents, 50);
mainIpc.progress.send(view, 50, "half");
mainIpc.progress.send(frame, 50, "half");
export const delivered: boolean = mainIpc.progress.sendToSender(event, 50, "half");
export const deliveredToInvoker: boolean = mainIpc.progress.sendToSender(invokeEvent, 50);
mainIpc.progress.broadcast(50, "half");
mainIpc.progress.broadcastTo((target: WebContents) => target.id === contents.id, 50);
mainIpc.titleChanged.broadcast("title");

// @ts-expect-error a send needs a target
mainIpc.progress.send(50);
// @ts-expect-error the target of a send is a window, a view or contents
mainIpc.progress.send("window", 50);
// @ts-expect-error sendToSender takes the event, not a target
mainIpc.progress.sendToSender(win, 50);
// @ts-expect-error sendToSender takes the arguments of the signature after the event
mainIpc.progress.sendToSender(event, "50");
// @ts-expect-error send channels have no sendToSender
mainIpc.logLine.sendToSender(event, "line");
// @ts-expect-error the filter of broadcastTo comes first
mainIpc.progress.broadcastTo(50, (target: WebContents) => target.id > 0);
// @ts-expect-error broadcast takes the arguments of the signature, not an options object
mainIpc.progress.broadcast(50, "half", { filter: () => true });
// @ts-expect-error send channels have no broadcast
mainIpc.logLine.broadcast("line");
// @ts-expect-error invoke channels have no broadcast
mainIpc.getUser.broadcast(1);
export const connection: { close: () => void } = mainIpc.chat.connect(win, win);
connection.close();
// @ts-expect-error the handle closes the connection, it does not send
connection.send("hi");

// @ts-expect-error invoke channels are only handled in the main process
mainIpc.getUser.invoke(1);
// @ts-expect-error invoke channels are only handled in the main process
mainIpc.getUser.on(() => undefined);
// @ts-expect-error handleOnce belongs to invoke channels
mainIpc.logLine.handleOnce(() => undefined);
// @ts-expect-error once belongs to send channels
mainIpc.getUser.once(() => undefined);
// @ts-expect-error send channels are only listened to in the main process
mainIpc.logLine.handle(() => undefined);
// @ts-expect-error emit channels are only sent from the main process
mainIpc.progress.on(() => undefined);
// @ts-expect-error channels without a trigger have no binder
mainIpc.progress.bind(win, () => [1]);
// @ts-expect-error port channels are only connected in the main process
mainIpc.chat.send("hi");
// @ts-expect-error the 0.2 names no longer exist
mainIpc.onGetUser(() => undefined);
