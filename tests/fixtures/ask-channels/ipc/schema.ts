import { ask, defineChannels, emit, invoke } from "automate-electron-ipc";

export interface EditorState {
   documentId: number;
   text: string;
}

export default defineChannels({
   hasUnsavedChanges: ask<(documentId: number) => boolean>(),
   getEditorState: ask<() => Promise<EditorState>>(),
   confirmClose: ask<(reason: string, ...flags: boolean[]) => void>(),
   describe: ask<(label?: string) => string>(),
   // Parameter names which the generated wrappers use themselves.
   nameClash: ask<(target: string, options: number, args: boolean) => string>(),
   genericAsk: ask<<T>(value: T) => T>(),
   // The other verbs next to the asks.
   getUser: invoke<(id: number) => Promise<string>>(),
   progress: emit<(percent: number) => void>(),
});
