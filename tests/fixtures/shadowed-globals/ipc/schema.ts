import { defineChannels, invoke, send } from "automate-electron-ipc";
// biome-ignore lint/suspicious/noShadowRestrictedNames: the schema shadows the global on purpose
import type { Map } from "./types/map";

// Names of globals that the schema declares or imports itself.
export interface Error {
   code: number;
   text: string;
}
export interface Promise<T> {
   value: T;
}

export default defineChannels({
   reportError: send<(error: Error) => void>(),
   getRegistry: invoke<() => Map>(),
   getBoxed: invoke<() => Promise<string>>(),
   // Not shadowed: stays the global type.
   getDate: invoke<() => Date>(),
});
