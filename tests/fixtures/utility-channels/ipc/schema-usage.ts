// Not a schema: it uses the generated bindings the way an application would,
// so that the type-check fails when the utility channels expose the wrong methods.
import type { UtilityProcess } from "electron";
import { attachUtility, forkUtility, IpcUtilityError, ipc as mainIpc } from "./main";
import type { Job, Summary } from "./schema";
import { IpcUtilityError as ChildUtilityError, ipc as utilityIpc } from "./utility";

declare const child: UtilityProcess;
declare const job: Job;

// Main: calls to the child take the child first, and return a promise of the awaited result.
attachUtility(child);
// forkUtility takes the arguments of utilityProcess.fork, and returns the attached child.
export const forked: UtilityProcess = forkUtility("child.js", ["--flag"], {
   serviceName: "indexer",
});
// @ts-expect-error the path of the module is required
forkUtility();
export const indexed: Promise<number> = mainIpc.indexFile.invoke(child, "/tmp");
export const summary: Promise<Summary> = mainIpc.runJob.invoke(child, job, "a", "b");
export const resetDone: Promise<void> = mainIpc.reset.invoke(child);
export const echoed: Promise<number> = mainIpc.echo.invoke(child, 1);
export const echoedText: Promise<string> = mainIpc.echo.invoke(child, "one");
mainIpc.setLogLevel.send(child, "debug");
mainIpc.pause.send(child);

// Main: the handlers and listeners of the messages of the child, which return disposers.
export const removeSetting: () => void = mainIpc.getSetting.handle(child, (key, fallback) => {
   const text: string = key;
   return Promise.resolve(fallback ?? text);
});
export const removeReport: () => void = mainIpc.report.handle(child, (summary) => {
   const files: number = summary.files;
   console.log(files);
});
export const removeProgress: () => void = mainIpc.progress.on(child, (done, total) => {
   const ratio: number = done / total;
   console.log(ratio);
});
export const removeOnce: () => void = mainIpc.jobDone.once(child, (finished) => {
   const id: number = finished.id;
   return Promise.resolve(console.log(id));
});

// Utility: the other side of every channel.
export const removeIndex: () => void = utilityIpc.indexFile.handle(async (path) => path.length);
export const removeRun: () => void = utilityIpc.runJob.handle((started, ...tags) => ({
   files: started.id + tags.length,
}));
export const removeReset: () => void = utilityIpc.reset.handle(() => undefined);
export const removeEcho: () => void = utilityIpc.echo.handle((value) => value);
export const removeLevel: () => void = utilityIpc.setLogLevel.on((level) => {
   const known: "debug" | "info" = level;
   console.log(known);
});
export const removePause: () => void = utilityIpc.pause.once(() => undefined);
export const setting: Promise<string | undefined> = utilityIpc.getSetting.invoke("theme");
export const settingOr: Promise<string | undefined> = utilityIpc.getSetting.invoke("theme", "dark");
export const reported: Promise<void> = utilityIpc.report.invoke({ files: 1 });
utilityIpc.progress.send(1, 2);
utilityIpc.jobDone.send(job);

async function failures(): Promise<void> {
   try {
      await mainIpc.indexFile.invoke(child, "/tmp");
      await utilityIpc.getSetting.invoke("theme");
   } catch (error) {
      if (error instanceof IpcUtilityError || error instanceof ChildUtilityError) {
         const code: string | number | undefined = error.code;
         const channel: string = error.channel;
         console.log(code, channel, error.data, error.name);
      }
   }
}
export const failed: Promise<void> = failures();

// @ts-expect-error the child comes first
mainIpc.indexFile.invoke("/tmp");
// @ts-expect-error the child is a UtilityProcess
mainIpc.indexFile.invoke("child", "/tmp");
// @ts-expect-error the arguments are those of the signature
mainIpc.indexFile.invoke(child, 7);
// @ts-expect-error a notification has no answer
export const noAnswer: Promise<void> = mainIpc.pause.send(child);
// @ts-expect-error the main process handles per child
mainIpc.getSetting.handle(async () => "x");
// @ts-expect-error the callback is the signature
mainIpc.report.handle(child, (summary: number) => console.log(summary));
// @ts-expect-error a call of the main process has no listeners, only a handler
mainIpc.getSetting.on(child, () => undefined);
// @ts-expect-error the utility process has no child argument
utilityIpc.getSetting.invoke(child, "theme");
// @ts-expect-error the arguments are those of the signature
utilityIpc.progress.send("1", 2);
// @ts-expect-error a handler returns what the signature says
utilityIpc.indexFile.handle(async (path) => path);
// @ts-expect-error a notification of the child has no handler
utilityIpc.progress.handle(() => undefined);
// @ts-expect-error the renderer channels are not in the utility file
utilityIpc.getJob.invoke(1);
