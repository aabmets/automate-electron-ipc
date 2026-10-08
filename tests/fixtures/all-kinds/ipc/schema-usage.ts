// Not a schema: it uses the generated bindings the way an application would,
// so that the type-check fails when a channel exposes the wrong methods.
import type { BrowserWindow } from "electron";
import { ipc as mainIpc } from "./main";

declare const win: BrowserWindow;

// Renderer: the bare global, `window.ipc` and `globalThis.ipc` are the same typed object.
export const user: Promise<string> = ipc.getUser.invoke(1);
export const userViaWindow: Promise<string> = window.ipc.getUser.invoke(1);
export const userViaGlobalThis: Promise<string> = globalThis.ipc.getUser.invoke(1);
ipc.logLine.send("line", 1, 2);
ipc.progress.on((percent: number, label?: string) => console.log(percent, label));
ipc.chat.send("hi");
ipc.chat.on((msg: string) => console.log(msg));

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
mainIpc.progress.send(win, 50, "half");
mainIpc.chat.connect(win, win);

// @ts-expect-error invoke channels are only handled in the main process
mainIpc.getUser.invoke(1);
// @ts-expect-error invoke channels are only handled in the main process
mainIpc.getUser.on(() => undefined);
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
