// Not a schema: it uses the generated bindings, so that the type-check fails when the utility
// file at the custom path imports the schema types from the wrong place.
import type { UtilityProcess } from "electron";
import { ipc as utilityIpc } from "../worker/generated/ipc";
import { ipc as mainIpc } from "./main";
import type { Row } from "./schema";

declare const child: UtilityProcess;

export const rows: Promise<Row[]> = mainIpc.query.invoke(child, "select 1");
export const removeRows: () => void = mainIpc.rows.on(child, (received: Row[]) => {
   console.log(received.length);
});
export const removeQuery: () => void = utilityIpc.query.handle((sql) =>
   Promise.resolve([{ id: sql.length }]),
);
utilityIpc.rows.send([{ id: 1 }]);
