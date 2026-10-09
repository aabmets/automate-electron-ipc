import { defineChannels, emit, invoke, send } from "automate-electron-ipc";
import type { Point } from "../shared/shapes";
import type { User } from "./models";

// The schema imports from two directories, and the generated files sit in three others.
export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>>(),
   movePoint: send<(point: Point) => void>(),
   userChanged: emit<(user: User) => void>(),
});
