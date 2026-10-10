import { createIpcMock, type IpcMock, installIpcMock } from "./mock";
import type { IpcApi } from "./types";

// The mock has the members of the API, with stubs for the calls, so it can stand in for `IpcApi`.
const api: IpcApi = createIpcMock();

const mock: IpcMock = createIpcMock({
   getUser: { invoke: async (id) => ({ id, name: "Ann" }) },
   getPathForFile: () => "/tmp/file",
});

mock.getUser.invoke.impl(async (id) => ({ id, name: String(id) }));
const userCalls: [number][] = mock.getUser.invoke.calls;
const lineCalls: [string, (number | undefined)?][] = mock.logLine.send.calls;
mock.emit.titleChanged("Home");
mock.emit.progress(50, "half");
const unsaved: Promise<boolean> = mock.ask.hasUnsaved(1);
const name: Promise<string> = mock.ask.askName();
mock.rows.stream.reset();
mock.titleChanged.on((title) => title.toUpperCase());
mock.hasUnsaved.handle((documentId) => documentId > 0);

// @ts-expect-error The argument of an invoke is a number.
mock.getUser.invoke("1");
// @ts-expect-error The title is a string.
mock.emit.titleChanged(1);
// @ts-expect-error The document ID is a number.
mock.ask.hasUnsaved("1");
// @ts-expect-error An override of a call has the type of the call.
createIpcMock({ getUser: { invoke: async (id: string) => ({ id: 1, name: id }) } });

const uninstall: () => void = installIpcMock(mock);
uninstall();
installIpcMock(undefined, {});

export { api, lineCalls, name, unsaved, userCalls };
