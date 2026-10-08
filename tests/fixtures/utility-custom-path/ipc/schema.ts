import { callUtility, defineChannels, notifyMain } from "automate-electron-ipc";

export interface Row {
   id: number;
}

// Only channels to the utility process: the files for the renderer stay empty.
export default defineChannels({
   query: callUtility<(sql: string) => Promise<Row[]>>(),
   rows: notifyMain<(rows: Row[]) => void>(),
});
