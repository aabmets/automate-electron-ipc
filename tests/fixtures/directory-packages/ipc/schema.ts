import type * as Aliased from "@ipc/models";
import type { Circle } from "@ipc/shapes";
import { defineChannels, invoke } from "automate-electron-ipc";
import { idArgs, type User } from "./models";
import type { Point } from "./plain";

// "./models" is a directory whose package.json names its entry point, which comes before its
// index file. "./plain" has a package.json without one, since `exports` does not apply to a
// relative specifier. "@ipc/*" is a path mapping of the tsconfig.
export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>>({ validate: idArgs }),
   getPoint: invoke<() => Promise<Point>>(),
   getCircle: invoke<() => Promise<Circle>>(),
   getAliased: invoke<() => Promise<Aliased.User>>(),
   getInline: invoke<() => Promise<import("./models").User>>(),
});
