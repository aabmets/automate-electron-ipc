# T69: Signature edge cases that produce wrong or confusing generated code

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in the review of Phases 0 and 1.
  - `renameTypeReferences` (T53) renames identifiers in the text of a signature. It skips quoted
    strings, including the `${...}` parts of template literal types, so a renamed type in
    `` `k-${User}` `` keeps its old name and binds to the wrong declaration (TS2322 in the
    generated files). It also renames a method name such as `{ User(): void }`.
  - A `this` parameter, `(this: Foo, a: string) => void`, is valid in a function type but the
    wrappers declare it as an ordinary parameter (TS2680, TS2730).
  - The return type check of `send`, `emit` and `port` compares text with `void` and
    `Promise<void>`, so `Promise<void >` is rejected with "return type 'Promise<void >' not
    allowed", which names the very type that is allowed.
- **Scope:**
  - Rename from the AST (record the spans of the type references instead of scanning text), which
    also removes the comment and quote guesses of the token scan.
  - Keep a `this` parameter out of the parameter list that wrappers forward, and in the signature
    text where it belongs (or reject it with a clear error).
  - Decide the void check from the AST of the return type.
- **Tests:** parser and writer unit tests for each case, plus e2e fixtures that type-check
  (`name-collisions` extended with a template literal type and a method name).
