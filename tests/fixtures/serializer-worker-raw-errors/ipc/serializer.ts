// A small serializer in the shape of superjson: `serialize` returns a cloneable `{ json }`, and
// `deserialize` restores the `Date`, `Map`, `Set`, `bigint` and `undefined` values that the
// structured clone of Electron would not carry through a class or a union.
export interface SerializedValue {
   json: unknown;
}

function encode(value: unknown): unknown {
   if (value instanceof Date) {
      return { $: "Date", v: value.toISOString() };
   }
   if (value instanceof Map) {
      return { $: "Map", v: [...value].map(([k, v]) => [encode(k), encode(v)]) };
   }
   if (value instanceof Set) {
      return { $: "Set", v: [...value].map(encode) };
   }
   if (typeof value === "bigint") {
      return { $: "BigInt", v: value.toString() };
   }
   if (value === undefined) {
      return { $: "undefined" };
   }
   if (typeof value === "function" || typeof value === "symbol") {
      throw new TypeError(`cannot serialize a ${typeof value}`);
   }
   if (Array.isArray(value)) {
      return value.map(encode);
   }
   if (typeof value === "object" && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [key, member] of Object.entries(value)) {
         out[key] = encode(member);
      }
      return { $: "Object", v: out };
   }
   return value;
}

function decode(value: unknown): unknown {
   if (Array.isArray(value)) {
      return value.map(decode);
   }
   if (typeof value !== "object" || value === null) {
      return value;
   }
   const tagged = value as { $: string; v: any };
   switch (tagged.$) {
      case "Date":
         return new Date(tagged.v);
      case "Map":
         return new Map(tagged.v.map(([k, v]: [unknown, unknown]) => [decode(k), decode(v)]));
      case "Set":
         return new Set(tagged.v.map(decode));
      case "BigInt":
         return BigInt(tagged.v);
      case "undefined":
         return undefined;
      case "Object":
         return Object.fromEntries(
            Object.entries(tagged.v).map(([key, member]) => [key, decode(member)]),
         );
      default:
         throw new TypeError("unknown tag in the serialized value");
   }
}

export function serialize<T>(value: T): SerializedValue {
   return { json: encode(value) };
}

export function deserialize<T = unknown>(wire: SerializedValue): T {
   return decode(wire.json) as T;
}
