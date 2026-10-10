// Not a schema: it registers handlers and listeners the way the main process of an application
// does for one window, so that the type-check fails when the `webContents` option is not accepted.
import type { WebContents } from "electron";
import { ipc } from "./main";

export function serve(contents: WebContents): () => void {
   const disposers: (() => void)[] = [
      ipc.getDoc.handle((_event, id) => Promise.resolve({ id, title: `doc ${id}` }), {
         webContents: contents,
      }),
      ipc.getDoc.handleOnce((_event, id) => Promise.resolve({ id, title: "once" }), {
         webContents: contents,
      }),
      ipc.log.on(
         (_event, text, ...rest) => {
            console.log(text, rest);
         },
         { webContents: contents },
      ),
      ipc.log.once(
         (_event, text) => {
            console.log(text);
         },
         { webContents: contents },
      ),
      ipc.rows.handle(
         async function* (_event, table) {
            await Promise.resolve();
            yield { id: table.length, title: table };
         },
         { webContents: contents },
      ),
   ];
   // Without the option, the registration is the global one.
   disposers.push(
      ipc.getDoc.handle((_event, id) => Promise.resolve({ id, title: "global" })),
      ipc.log.on(() => undefined, {}),
   );
   return () => {
      for (const dispose of disposers) {
         dispose();
      }
   };
}
