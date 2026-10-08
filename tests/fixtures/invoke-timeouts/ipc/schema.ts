import { defineChannels, invoke, send } from "automate-electron-ipc";

export class NotFoundError extends Error {
   override readonly name = "NotFoundError";
   readonly code = "NOT_FOUND";
}

export default defineChannels({
   // Its own timeout, shorter than the default of the config.
   slow: invoke<(id: number) => Promise<string>, NotFoundError>({ timeoutMs: 1000 }),
   // No option: the default of the config applies.
   defaulted: invoke<() => number>(),
   // 0 turns the timeout off for this channel.
   patient: invoke<() => Promise<string>>({ timeoutMs: 0 }),
   // The alternative form takes the option too.
   legacy: invoke({ timeoutMs: 300 }) as () => Promise<void>,
   ping: send<() => void>(),
});
