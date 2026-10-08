// A hand-written Standard Schema, so that the fixture needs no validation library.
import type { StandardSchemaV1 } from "automate-electron-ipc";

export const countArgs: StandardSchemaV1<unknown, [count: number]> = {
   "~standard": {
      version: 1,
      vendor: "fixture",
      validate: (value) =>
         Array.isArray(value) && value.length === 1 && typeof value[0] === "number"
            ? { value: [value[0]] as [number] }
            : { issues: [{ message: "expected one number" }] },
   },
};
