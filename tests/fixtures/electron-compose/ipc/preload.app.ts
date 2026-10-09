// Not a schema: the preload script of an application, which composes the generated one. The
// Electron tests load it as the preload script of the scope `app`, and inline `./preload` into it
// as a bundler would.
import { contextBridge } from "electron";
import { api, expose } from "./preload";

expose();
expose("second");
contextBridge.exposeInMainWorld("app", {
   channels: (): string[] => Object.keys(api).sort(),
   greet: async (id: number): Promise<string> => `hello, ${await api.getUser.invoke(id)}`,
});
