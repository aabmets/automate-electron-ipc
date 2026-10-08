// biome-ignore-all lint/suspicious/useAwait: the handlers are async to match the signatures, and have nothing to await
// Not a schema: it uses the generated bindings the way an application would,
// so that the type-check fails when the channels expose the wrong methods.
import type { BrowserWindow, UtilityProcess, WebContents, WebContentsView } from "electron";
import { ipc as mainIpc } from "./main";
import type { QueryError, Row } from "./schema";
import { ipc as utilityIpc } from "./utility";

declare const child: UtilityProcess;
declare const win: BrowserWindow;
declare const contents: WebContents;
declare const view: WebContentsView;

// Main: the child and the target, a window, a view or contents. It returns the handle to close.
export const link: { close: () => void } = mainIpc.queryRows.connect(child, win);
mainIpc.scanRows.connect(child, contents).close();
mainIpc.counter.connect(child, view);
mainIpc.ping.connect(child, win);
// @ts-expect-error the child comes first
mainIpc.queryRows.connect(win, child);
// @ts-expect-error the main process has no invoke for a call of the page
mainIpc.queryRows.invoke(child, "select 1");

// Utility: the handlers, which return disposers.
export const removeQuery: () => void = utilityIpc.queryRows.handle(async (sql, limit) => {
   const row: Row = { id: sql.length, label: String(limit) };
   return [row];
});
utilityIpc.countRows.handle((table) => table.length);
utilityIpc.ping.handle(() => undefined);
utilityIpc.tagged.handle(async (label, ...tags) => `${label}:${tags.join(",")}`);
utilityIpc.asForm.handle(async (n) => n + 1);
export const removeScan: () => void = utilityIpc.scanRows.handle(async function* (table) {
   yield { id: 1, label: table } satisfies Row;
});
utilityIpc.counter.handle(async function* () {
   yield 1;
});
utilityIpc.streamForm.handle(async function* (seed) {
   yield seed;
});
// @ts-expect-error a stream handler returns an async iterable of the chunks, not a promise of one
utilityIpc.scanRows.handle(async (table: string) => [{ id: 1, label: table }]);
// @ts-expect-error the chunks have the type of the signature
utilityIpc.counter.handle(async function* () {
   yield "text";
});
// @ts-expect-error the result has the type of the signature
utilityIpc.countRows.handle(() => "text");
// @ts-expect-error a handler of a call does not return a stream
utilityIpc.queryRows.handle(async function* () {
   yield 1;
});
// @ts-expect-error the child has no invoke for a call of the page
utilityIpc.queryRows.invoke("select 1");
// @ts-expect-error the channel to the main process is not in the utility file
utilityIpc.getUser.handle(async () => "");

// Renderer: the calls return promises of the awaited results.
export const rows: Promise<Row[]> = ipc.queryRows.invoke("select 1", 10);
export const count: Promise<number> = ipc.countRows.invoke("rows");
export const pinged: Promise<void> = ipc.ping.invoke();
export const tagged: Promise<string> = ipc.tagged.invoke("a", "b", "c");
export const viaAs: Promise<number> = ipc.asForm.invoke(1);
export const user: Promise<string> = ipc.getUser.invoke(1);

export async function failures(): Promise<void> {
   try {
      await ipc.queryRows.invoke("select 1");
   } catch (error) {
      // The errors of the handler, and the errors of the library.
      const failure = error as IpcError<QueryError | IpcUtilityError>;
      if (failure.code === "E_QUERY") {
         const sql: string = failure.data.sql;
         console.log(sql);
      } else {
         const code:
            | "IPC_UTILITY_EXITED"
            | "IPC_UTILITY_UNSENDABLE"
            | "IPC_UTILITY_INVALID_REPLY"
            | "IPC_UTILITY_NO_HANDLER"
            | "IPC_UTILITY_NOT_ITERABLE" = failure.code;
         console.log(code);
      }
   }
}

// Renderer: the stream is read like an async iterable, and has cancel().
export async function read(): Promise<Row[]> {
   const rows: Row[] = [];
   for await (const row of ipc.scanRows.stream("rows")) {
      rows.push(row);
   }
   return rows;
}
export async function readByHand(): Promise<number | undefined> {
   const stream = ipc.counter.stream();
   const first = await stream.next();
   await stream.return();
   stream.cancel();
   return first.done ? undefined : first.value;
}
export const viaStreamForm: AsyncIterable<string> = ipc.streamForm.stream("seed");

// @ts-expect-error the arguments are those of the signature
ipc.queryRows.invoke(1);
// @ts-expect-error the page has no handle
ipc.queryRows.handle(async () => []);
// @ts-expect-error the page has no connect
ipc.queryRows.connect(child, win);
// @ts-expect-error a stream is read with stream(), not invoke()
ipc.scanRows.invoke("rows");
// @ts-expect-error the chunks have the type of the signature
export const wrongChunk: AsyncIterable<string> = ipc.counter.stream();
