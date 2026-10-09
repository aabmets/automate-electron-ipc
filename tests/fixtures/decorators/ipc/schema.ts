import { defineChannels, invoke } from "automate-electron-ipc";

function sealed(_target: unknown, _context: ClassDecoratorContext) {
   // A decorator that does nothing is enough for the parser.
}

// A decorated class in the schema file, as an entity of an ORM would be.
@sealed
export class Entity {
   id = 1;
}

export interface User {
   id: number;
}

export default defineChannels({
   getUser: invoke<(id: number) => Promise<User>>(),
});
