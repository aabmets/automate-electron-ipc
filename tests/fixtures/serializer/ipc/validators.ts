// A hand-written Standard Schema, so that the fixture needs no validation library. It accepts a
// `Date` argument only, which shows that the arguments are deserialized before they are checked.
import type { StandardSchemaV1 } from "automate-electron-ipc";

export const whenArgs: StandardSchemaV1<unknown, [when: Date]> = {
   "~standard": {
      version: 1,
      vendor: "fixture",
      validate: (value) =>
         Array.isArray(value) && value.length === 1 && value[0] instanceof Date
            ? { value: [value[0]] as [Date] }
            : { issues: [{ message: "expected one Date" }] },
   },
};
