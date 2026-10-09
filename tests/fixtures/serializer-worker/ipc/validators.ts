// A hand-written Standard Schema, so that the fixture needs no validation library. It runs after the
// serializer has restored the `Date`, so it accepts only a real one.
import type { StandardSchemaV1 } from "automate-electron-ipc";

export const dateArgs: StandardSchemaV1<unknown, [at: Date]> = {
   "~standard": {
      version: 1,
      vendor: "fixture",
      validate: (value) =>
         Array.isArray(value) && value.length === 1 && value[0] instanceof Date
            ? { value: [value[0]] as [Date] }
            : { issues: [{ message: "expected one Date", path: [0] }] },
   },
};
