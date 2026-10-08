import { defineChannels, emit, invoke, send } from "automate-electron-ipc";

export interface Point {
   x: number;
   y: number;
}

export default defineChannels({
   restSum: emit<(label: string, ...values: number[]) => void>(),
   optionalFlag: emit<(label: string, flag?: boolean) => void>(),
   destructured: emit<({ x, y }: Point, [first, second]: [number, number]) => void>(),
   restLog: send<(...lines: string[]) => void>(),
   restTotal: invoke<(...values: number[]) => Promise<number>>(),
});
