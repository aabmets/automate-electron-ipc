// Not a schema: it uses the generated types of the windows that are in no scope.
export const version: Promise<string> = window.ipc.getVersion.invoke();
window.ipc.log.send("hello");
// @ts-expect-error a channel of the settings window
window.ipc.getSettings.invoke();
// @ts-expect-error a channel of the editor window
window.ipc.openFile.invoke("a.txt");
// @ts-expect-error a channel of both windows
window.ipc.notify.send("hello");
