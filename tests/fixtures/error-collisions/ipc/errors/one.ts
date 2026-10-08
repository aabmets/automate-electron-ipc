export class Conflict extends Error {
   override readonly name = "ConflictOne";
   readonly code = "ONE";
}

export class Ok extends Error {}
