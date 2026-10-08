// Käyttäjä: 日本語 and 😀 in a comment before the channel map
import { defineChannels, emit, invoke, send } from "automate-electron-ipc";

export type Üser = { name: "é" | "日本" };
export interface Größe {
   value: number;
}

export default defineChannels({
   // Ünïcode comment
   getÜser: invoke<(id: "ñ", size: Größe) => Promise<Üser>>(),
   greet: send<(message: "héllo 😀") => void>(),
   generic:
      invoke<
         /* コメント */ <T extends "ü" = "ü">(/* é */ arg: T) => Promise<T>
      >(),
   update: emit<(user: Üser) => void>(),
});
