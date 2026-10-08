// Not a schema: it uses the generated types the way an application would,
// so that the type-check fails when an invoke sender is not typed as a promise.
import type { PromiseResult } from "./schema";

export const plain: Promise<number> = window.ipc.sendPlain();
export const userType: Promise<PromiseResult> = window.ipc.sendUserType();
export const promiseLike: Promise<string> = window.ipc.sendPromiseLike();
export const real: Promise<string> = window.ipc.sendReal(1);
