import { defineChannels, invoke, send, stream } from "automate-electron-ipc";

export interface Doc {
   id: number;
   title: string;
}

export default defineChannels({
   getDoc: invoke<(id: number) => Promise<Doc>>(),
   log: send<(text: string, ...rest: number[]) => void>(),
   rows: stream<(table: string) => AsyncIterable<Doc>>(),
});
