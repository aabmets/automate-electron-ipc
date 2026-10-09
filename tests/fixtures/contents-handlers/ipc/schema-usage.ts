// Not a schema: it registers handlers and listeners the way the main process of an application
// does for one window, so that the type-check fails when the `webContents` option is not accepted.
import type { WebContents } from "electron";
import { ipc } from "./main";

export function serve(contents: WebContents): () => void {
   const seen: unknown[] = [];
   const disposers: (() => void)[] = [
      ipc.getDoc.handle(async (_event, id) => ({ id, title: `doc ${id}` }), {
         webContents: contents,
      }),
      ipc.getDoc.handleOnce(async (_event, id) => ({ id, title: "once" }), {
         webContents: contents,
      }),
      ipc.log.on(
         (_event, text, ...rest) => {
            seen.push(text, rest);
         },
         { webContents: contents },
      ),
      ipc.log.once(
         (_event, text) => {
            seen.push(text);
         },
         { webContents: contents },
      ),
      ipc.rows.handle(
         // biome-ignore lint/suspicious/useAwait: a generator which has nothing to wait for
         async function* (_event, table) {
            yield { id: table.length, title: table };
         },
         { webContents: contents },
      ),
   ];
   // Without the option, the registration is the global one.
   disposers.push(ipc.getDoc.handle(async (_event, id) => ({ id, title: "global" })));
   disposers.push(ipc.log.on(() => undefined, {}));
   return () => {
      for (const dispose of disposers) {
         dispose();
      }
   };
}
