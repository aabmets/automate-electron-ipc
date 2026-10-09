import type { StandardSchemaV1 } from "automate-electron-ipc";

export interface User {
   id: number;
}

export const idArgs: StandardSchemaV1<unknown, [id: number]> = {
   "~standard": {
      version: 1,
      vendor: "fixture",
      validate: (value) =>
         Array.isArray(value) && typeof value[0] === "number"
            ? { value: value as [id: number] }
            : { issues: [{ message: "expected one number" }] },
   },
};
