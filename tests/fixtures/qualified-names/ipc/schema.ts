import { defineChannels, send } from "automate-electron-ipc";
import { config } from "./types/config";
import { Kind } from "./types/kind";
import type * as Shapes from "./types/shapes";

export enum Mode {
   Fast = "fast",
   Slow = "slow",
}

export interface Options {
   mode: Mode;
}

export default defineChannels({
   // A member of an enum that is a named import.
   setKind: send<(kind: Kind.A) => void>(),
   // A member of an enum that is declared in this file.
   setMode: send<(mode: Mode.Fast) => void>(),
   // A member of a namespace import.
   setCircle: send<(circle: Shapes.Circle) => void>(),
   // A typeof query of a value import.
   setConfig: send<(current: typeof config) => void>(),
   // A destructured param. TypeScript rejects a renamed binding in a function type (TS2842).
   setOptions: send<({ mode }: Options) => void>(),
});
