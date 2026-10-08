// A hand-written Standard Schema, so that the fixture needs no validation library.
import type { StandardSchemaV1 } from "automate-electron-ipc";

export function tuple<T extends unknown[]>(
   check: (args: unknown[]) => string | null,
): StandardSchemaV1<unknown, T> {
   return {
      "~standard": {
         version: 1,
         vendor: "fixture",
         validate: (value) => {
            const message = Array.isArray(value) ? check(value) : "not an array";
            return message === null ? { value: value as T } : { issues: [{ message }] };
         },
      },
   };
}

export const idArgs = tuple<[id: number]>((args) =>
   args.length === 1 && typeof args[0] === "number" ? null : "expected one number",
);

export const lineArgs = tuple<[text: string, ...rest: number[]]>((args) =>
   typeof args[0] === "string" && args.slice(1).every((a) => typeof a === "number")
      ? null
      : "expected a string and numbers",
);

export default tuple<[]>((args) => (args.length === 0 ? null : "expected no arguments"));
