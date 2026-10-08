import { defineChannels, invoke } from "automate-electron-ipc";

export interface PromiseResult {
   ok: boolean;
}

export default defineChannels({
   plain: invoke<() => number>(),
   userType: invoke<() => PromiseResult>(),
   promiseLike: invoke<() => PromiseLike<string>>(),
   real: invoke<(id: number) => Promise<string>>(),
});
