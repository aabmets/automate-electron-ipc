// Not a schema: it uses the generated bindings the way an application would,
// so that the type-check fails when the channels expose the wrong methods.
import type { UtilityProcess } from "electron";
import { IpcUtilityError as MainUtilityError, ipc as mainIpc } from "./main";
import { IpcUtilityError as ChildUtilityError, ipc as utilityIpc } from "./utility";

declare const child: UtilityProcess;

// Main: the calls to the child carry no extra argument for the timeout, which the schema decides.
export async function main(): Promise<number> {
   try {
      mainIpc.pause.send(child);
      await mainIpc.patientIndex.invoke(child);
      await mainIpc.legacyIndex.invoke(child);
      return await mainIpc.slowIndex.invoke(child, "a.txt");
   } catch (error) {
      if (error instanceof MainUtilityError && error.code === "IPC_UTILITY_TIMEOUT") {
         return -1;
      }
      throw error;
   }
}
// @ts-expect-error the timeout is no argument of the call
mainIpc.slowIndex.invoke(child, "a.txt", { timeoutMs: 5 });

// Utility: the call to the main process, and the handlers of the child.
export async function utility(): Promise<string> {
   try {
      return await utilityIpc.slowSetting.invoke("theme");
   } catch (error) {
      if (error instanceof ChildUtilityError && error.code === "IPC_UTILITY_TIMEOUT") {
         return "";
      }
      throw error;
   }
}
utilityIpc.slowIndex.handle((path) => Promise.resolve(path.length));
utilityIpc.slowQuery.handle((sql) => Promise.resolve(sql));
utilityIpc.slowRows.handle(async function* (table) {
   await Promise.resolve();
   yield table.length;
});

// Renderer: the timeout error is one of the library's utility codes, in the plain object form.
export async function page(): Promise<string> {
   try {
      return await window.ipc.slowQuery.invoke("select 1");
   } catch (error) {
      const failure = error as IpcError<IpcUtilityError>;
      const code:
         | "IPC_UTILITY_EXITED"
         | "IPC_UTILITY_UNSENDABLE"
         | "IPC_UTILITY_INVALID_REPLY"
         | "IPC_UTILITY_NO_HANDLER"
         | "IPC_UTILITY_NOT_ITERABLE"
         | "IPC_UTILITY_TIMEOUT" = failure.code;
      return code;
   }
}
