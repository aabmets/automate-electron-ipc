import { askWorker, defineChannels, invokeFromWorker, sendFromWorker } from "automate-electron-ipc";
import { scopeArgs, slowArgs, stateArgs } from "./validators";

export default defineChannels({
   // Validated, and with the default timeout of the config (5000).
   getToken: invokeFromWorker<(scope: string) => Promise<string>>({ validate: scopeArgs }),
   // An own timeout, and no validation.
   slowStatus: invokeFromWorker<() => Promise<string>>({ timeoutMs: 800 }),
   // The timeout is off, and the origin is checked besides the arguments.
   patientStatus: invokeFromWorker<(scope: string) => Promise<string>>({
      timeoutMs: 0,
      allowedOrigins: ["app://main"],
      validate: scopeArgs,
   }),
   // The schema is slow.
   slowEcho: invokeFromWorker<(value: string) => string>({ validate: slowArgs }),
   // No option at all, so the default timeout applies.
   plainStatus: invokeFromWorker<() => number>(),
   reportState: sendFromWorker<(pending: number) => void>({ validate: stateArgs }),
   slowReport: sendFromWorker<(value: string) => void>({ validate: slowArgs }),
   plainReport: sendFromWorker<(text: string) => void>(),
   // A question to a worker has no option: its caller can use invokeWith.
   flush: askWorker<(force: boolean) => number>(),
});
