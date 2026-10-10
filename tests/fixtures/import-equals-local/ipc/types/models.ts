import * as Shapes from "./shapes";

export interface User {
   id: number;
}

// `export * as Shapes from` would be a barrel file, which Biome forbids.
export { Shapes }; // NOSONAR
