// A hand-written Standard Schema, so that the fixture needs no validation library.
import type { StandardSchemaV1 } from "automate-electron-ipc";

export function tuple<T extends unknown[]>(
   check: (args: unknown[]) => string | null,
   delayMs = 0,
): StandardSchemaV1<unknown, T> {
   return {
      "~standard": {
         version: 1,
         vendor: "fixture",
         validate: (value) => {
            const message = Array.isArray(value) ? check(value) : "not an array";
            const result = message === null ? { value: value as T } : { issues: [{ message }] };
            return delayMs > 0
               ? new Promise((resolve) => setTimeout(() => resolve(result), delayMs))
               : result;
         },
      },
   };
}

export const scopeArgs = tuple<[scope: string]>((args) =>
   args.length === 1 && typeof args[0] === "string" ? null : "expected one string",
);

export const stateArgs = tuple<[pending: number]>((args) =>
   args.length === 1 && typeof args[0] === "number" ? null : "expected one number",
);

// A schema that answers late, which a once handler can be used up during.
export const slowArgs = tuple<[value: string]>(
   (args) => (args.length === 1 && typeof args[0] === "string" ? null : "expected one string"),
   50,
);
