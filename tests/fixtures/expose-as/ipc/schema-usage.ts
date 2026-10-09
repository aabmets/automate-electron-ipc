// Not a schema: it uses the generated types the way an application would, so that the
// type-check fails when the declared variable does not follow `exposeAs`.
export const user: Promise<string> = window.bridge.getUser.invoke(1);
export const viaGlobal: Promise<string> = globalThis.bridge.getUser.invoke(3);
window.bridge.logLine.send("hello");
