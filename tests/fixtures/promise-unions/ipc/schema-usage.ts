// Not a schema: it uses the generated types the way an application would,
// so that the type-check fails when a result of `Promise<X> | X` is not typed as a promise of X.
export const lookup: Promise<string> = window.ipc.lookup.invoke(1);
export const maybe: Promise<string | null> = window.ipc.maybe.invoke();
export const awaited: Promise<number> = window.ipc.awaited.invoke();
export const thenable: Promise<boolean> = window.ipc.thenable.invoke();
