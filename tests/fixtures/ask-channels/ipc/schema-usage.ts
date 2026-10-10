// Not a schema: it uses the generated bindings the way an application would,
// so that the type-check fails when an ask channel exposes the wrong methods.
import type { BrowserWindow, WebContents, WebContentsView, WebFrameMain } from "electron";
import { IpcAskError, type IpcAskOptions, ipc as mainIpc } from "./main";
import type { EditorState } from "./schema";

declare const win: BrowserWindow;
declare const contents: WebContents;
declare const view: WebContentsView;
declare const frame: WebFrameMain;

// Main: every target, and the answer is a promise of the awaited result.
export const unsaved: Promise<boolean> = mainIpc.hasUnsavedChanges.invoke(win, 7);
export const unsavedOfContents: Promise<boolean> = mainIpc.hasUnsavedChanges.invoke(contents, 7);
export const unsavedOfView: Promise<boolean> = mainIpc.hasUnsavedChanges.invoke(view, 7);
export const unsavedOfFrame: Promise<boolean> = mainIpc.hasUnsavedChanges.invoke(frame, 7);
export const state: Promise<EditorState> = mainIpc.getEditorState.invoke(win);
export const closed: Promise<void> = mainIpc.confirmClose.invoke(win, "quit", true, false);
export const described: Promise<string> = mainIpc.describe.invoke(win);
export const describedAs: Promise<string> = mainIpc.describe.invoke(win, "label");
export const generic: Promise<number> = mainIpc.genericAsk.invoke(win, 5);
export const unsavedInTime: Promise<boolean> = mainIpc.hasUnsavedChanges.invokeWith(
   win,
   { timeoutMs: 500 },
   7,
);
const options: IpcAskOptions = {};
mainIpc.describe.invokeWith(win, options, "label");

async function ask(): Promise<void> {
   try {
      await mainIpc.hasUnsavedChanges.invoke(win, 7);
   } catch (error) {
      if (error instanceof IpcAskError) {
         const code: string | number | undefined = error.code;
         const channel: string = error.channel;
         console.log(code, channel, error.data, error.name);
      }
   }
}
export const asked: Promise<void> = ask();

// @ts-expect-error an ask needs a target
mainIpc.hasUnsavedChanges.invoke(7);
// @ts-expect-error the target is a window, a view, contents or a frame
mainIpc.hasUnsavedChanges.invoke("window", 7);
// @ts-expect-error the arguments are those of the signature
mainIpc.hasUnsavedChanges.invoke(win, "7");
// @ts-expect-error the options come before the arguments
mainIpc.hasUnsavedChanges.invokeWith(win, 7, { timeoutMs: 500 });
// @ts-expect-error the timeout is a number
mainIpc.hasUnsavedChanges.invokeWith(win, { timeoutMs: "500" }, 7);
// @ts-expect-error the answer is a boolean
export const wrongAnswer: Promise<string> = mainIpc.hasUnsavedChanges.invoke(win, 7);
// @ts-expect-error an ask is not handled in the main process
mainIpc.hasUnsavedChanges.handle(() => true);
// @ts-expect-error an ask is not sent
mainIpc.hasUnsavedChanges.send(win, 7);
// @ts-expect-error an ask is not broadcast
mainIpc.hasUnsavedChanges.broadcast(7);
// @ts-expect-error an ask is not answered to the sender
mainIpc.hasUnsavedChanges.sendToSender({ senderFrame: frame }, 7);
// @ts-expect-error emit channels cannot be asked
mainIpc.progress.invoke(win, 50);
// @ts-expect-error invoke channels cannot be asked
mainIpc.getUser.invokeWith(win, {}, 1);

// Renderer: a single responder, which may answer in a promise, and a disposer.
export const stop: () => void = ipc.hasUnsavedChanges.handle(
   (documentId: number) => documentId > 0,
);
export const stopAsync: () => void = ipc.getEditorState.handle(() =>
   Promise.resolve({
      documentId: 1,
      text: "text",
   }),
);
ipc.confirmClose.handle((reason: string, ...flags: boolean[]) => console.log(reason, flags));
ipc.describe.handle((label?: string) => label ?? "none");
window.ipc.hasUnsavedChanges.handle(() => false);
stop();

// @ts-expect-error the responder returns the answer of the signature
ipc.hasUnsavedChanges.handle(() => "yes");
// @ts-expect-error the responder takes the arguments of the signature, without a target
ipc.hasUnsavedChanges.handle((_target: WebContents, documentId: number) => documentId > 0);
// @ts-expect-error the main process asks, the renderer cannot
ipc.hasUnsavedChanges.invoke(7);
// @ts-expect-error the main process asks, the renderer cannot
ipc.hasUnsavedChanges.send(7);
// @ts-expect-error an ask has no listeners to subscribe
ipc.hasUnsavedChanges.on(() => true);
// @ts-expect-error an ask has a single responder, with no once
ipc.hasUnsavedChanges.once(() => true);
