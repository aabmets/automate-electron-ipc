// Not a schema: it uses the generated types of the editor window.
export const file: Promise<{ path: string; text: string }> = window.ipc.openFile.invoke("a.txt");
window.ipc.hasUnsavedChanges.handle(() => true);
window.ipc.chat.send("hi");
window.ipc.exportRows.stream("rows").cancel();
window.ipc.notify.send("hello");
window.ipc.getVersion.invoke();
// @ts-expect-error a channel of the settings window
window.ipc.getSettings.invoke();
// @ts-expect-error a channel of the settings window
window.ipc.themeChanged.on(() => undefined);
