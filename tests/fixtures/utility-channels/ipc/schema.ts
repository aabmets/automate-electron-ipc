import {
   callMain,
   callUtility,
   defineChannels,
   invoke,
   notifyMain,
   notifyUtility,
} from "automate-electron-ipc";

export interface Job {
   id: number;
   path: string;
}

export interface Summary {
   files: number;
}

export default defineChannels({
   // Main process to the utility process.
   indexFile: callUtility<(path: string) => Promise<number>>(),
   runJob: callUtility<(job: Job, ...tags: string[]) => Summary>(),
   reset: callUtility<() => void>(),
   echo: callUtility<<T>(value: T) => T>(),
   setLogLevel: notifyUtility<(level: "debug" | "info") => void>(),
   pause: notifyUtility<() => void>(),
   // Utility process to the main process.
   getSetting: callMain<(key: string, fallback?: string) => Promise<string | undefined>>(),
   report: callMain() as (summary: Summary) => void,
   progress: notifyMain<(done: number, total: number) => void>(),
   jobDone: notifyMain<(job: Job) => Promise<void>>(),
   // A channel for the renderer, which the utility files must leave alone.
   getJob: invoke<(id: number) => Promise<Job>>(),
});
