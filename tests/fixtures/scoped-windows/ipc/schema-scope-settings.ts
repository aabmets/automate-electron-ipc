// Not a schema: it uses the generated types of the settings window.
export const settings: Promise<{ theme: string }> = window.ipc.getSettings.invoke();
window.ipc.saveSettings.invoke({ theme: "light" });
window.ipc.themeChanged.on((theme: string) => console.log(theme));
window.ipc.notify.send("hello");
window.ipc.getVersion.invoke();
window.ipc.log.send("hello");
// @ts-expect-error a channel of the editor window
window.ipc.openFile.invoke("a.txt");
// @ts-expect-error a channel of the editor window
window.ipc.chat.send("hi");
