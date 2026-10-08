import { defineChannels, invoke, send } from "automate-electron-ipc";

export const config = { theme: "dark", size: 12 };

export function createUser(name: string) {
   return { name, id: 1 };
}

const defaults = { retries: 3 };
const secret = { token: "abc" };

export { defaults as Defaults };

export default function main() {
   return { started: true };
}

export const channels = defineChannels({
   // A typeof query of an exported const, and of one of its members.
   setConfig: send<(current: typeof config) => void>(),
   setTheme: send<(theme: (typeof config)["theme"]) => void>(),
   // A typeof query of an exported function, used through utility types.
   addUser: invoke<(user: ReturnType<typeof createUser>) => Promise<void>>(),
   // A value that is exported under another name, and a default exported function.
   setDefaults: send<(value: typeof defaults) => void>(),
   getMain: invoke<() => Promise<ReturnType<typeof main>>>(),
});

// Not queried by any signature, so it need not be exported.
export type Unused = typeof secret;
