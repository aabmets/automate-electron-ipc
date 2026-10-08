// Not a schema: it uses the generated bindings the way an application would,
// so that the type-check fails when a stream channel exposes the wrong methods.
import { ipc as mainIpc } from "./main";
import type { NotFoundError, Progress, Row } from "./schema";

// Main: the handler is an async generator, and gets the event in front of the arguments.
export const stopRows: () => void = mainIpc.exportRows.handle(async function* (
   event,
   table: string,
   limit?: number,
) {
   console.log(event.sender.id, event.senderFrame?.origin);
   for (let id = 1; id <= (limit ?? 3); id++) {
      yield { id, label: `${table}-${id}` } satisfies Row;
   }
});
mainIpc.tokens.handle(async function* (_event, prompt: string) {
   yield prompt;
});
mainIpc.counter.handle(async function* () {
   yield 1;
});
mainIpc.progress.handle(async function* (_event, job: string, ...flags: boolean[]) {
   yield { done: flags.length, total: job.length } satisfies Progress;
});
mainIpc.genericStream.handle(async function* <T>(_event: unknown, seed: T) {
   yield seed;
});
mainIpc.guarded.handle(async function* (_event, count: number) {
   yield count;
});
mainIpc.asForm.handle(async function* (_event, count: number) {
   yield count;
});
stopRows();

// @ts-expect-error a handler returns an async iterable of the chunks, not a promise of one
mainIpc.exportRows.handle(async (_event, table: string) => [{ id: 1, label: table }]);
// @ts-expect-error the chunks have the type of the signature
mainIpc.counter.handle(async function* () {
   yield "text";
});
// @ts-expect-error a stream has no handleOnce
mainIpc.exportRows.handleOnce(async function* () {});

// Renderer: the call returns the stream, which is read like an async iterable.
export async function read(): Promise<Row[]> {
   const rows: Row[] = [];
   for await (const row of ipc.exportRows.stream("table", 5)) {
      rows.push(row);
   }
   return rows;
}
export async function readWithError(): Promise<void> {
   const stream = ipc.exportRows.stream("missing");
   try {
      for await (const row of stream) {
         console.log(row.id, row.label);
      }
   } catch (error) {
      const failure = error as IpcError<NotFoundError>;
      const code: "E_NOT_FOUND" = failure.code;
      const table: string = failure.data.table;
      console.log(code, table);
   }
}
export async function readByHand(): Promise<number | undefined> {
   const stream = ipc.counter.stream();
   const first = await stream.next();
   await stream.return();
   stream.cancel();
   return first.done ? undefined : first.value;
}
export async function stopWithSignal(signal: AbortSignal): Promise<void> {
   const stream = ipc.tokens.stream("go");
   signal.addEventListener("abort", () => stream.cancel(), { once: true });
   for await (const token of stream) {
      const text: string = token;
      console.log(text);
   }
}
export const progress = ipc.progress.stream("job", true, false);
export const generic: AsyncIterable<number> = ipc.genericStream.stream(1);
export const viaAs: AsyncIterable<number> = ipc.asForm.stream(3);

// @ts-expect-error the arguments are those of the signature
ipc.exportRows.stream(1);
// @ts-expect-error the chunks have the type of the signature
export const wrongChunk: AsyncIterable<string> = ipc.counter.stream();
// @ts-expect-error there is no options argument: cancel() stops the stream
ipc.counter.stream({ signal: new AbortController().signal });
// @ts-expect-error the page has no handle
ipc.exportRows.handle(async function* () {});
