// Not a schema: it uses the generated bindings the way an application would.
import { ipc as mainIpc } from "./main";

export const echoed: Promise<number> = window.ipc.genericInvoke.invoke(1);

mainIpc.genericSend.on((_event, cb) => cb(1));
mainIpc.genericInvoke.handle((_event, value) => value);
