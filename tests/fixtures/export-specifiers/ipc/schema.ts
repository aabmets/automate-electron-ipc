import { defineChannels, invoke, send } from "automate-electron-ipc";

interface Plain {
   id: number;
   hidden?: Hidden;
}

interface Renamed {
   label: string;
}

type Primary = { value: number };

// Only used by another type, so it need not be exported.
interface Hidden {
   secret: string;
}

export type { Plain, Primary as Main, Renamed as PublicRenamed };

export default class Account<T> {
   id!: T;
}

export const channels = defineChannels({
   getPlain: invoke<(id: number) => Promise<Plain>>(),
   rename: send<(label: Renamed) => void>(),
   getAccount: invoke<(id: number) => Promise<Account<number>>>(),
   setPrimary: invoke<(value: Primary) => Promise<Primary>>(),
});
