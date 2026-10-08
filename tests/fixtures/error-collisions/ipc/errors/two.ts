export class Conflict extends Error {
   override readonly name = "ConflictTwo";
   readonly code = "TWO";
}
