# T19: Structured-clone awareness in signatures

Phase 2: Core API, listener lifecycle and security.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:**
  - Electron throws when sending Functions, Promises (other than invoke results), Symbols, WeakMaps
    or WeakSets.
  - Class instances lose their prototype.
  - None of this is checked.
- **Scope:**
  - At generation time, error on parameter or return types that are or contain `Function`, function
    types, `symbol`, `WeakMap`, `WeakSet`, or `Promise` in parameters.
  - Warn on types that resolve to classes declared in the schema file.
- **Tests:** validator unit tests for each forbidden form, including nested object and array members.
- **Delivered:** 2026-10-08. Deviations and notes:
  - `parseSignature` walks the type AST of every parameter and the return type and records the
    findings as `signature.cloneIssues`. `validateChannelSpecs` throws for the errors, all of them
    in one message, and `getCloneWarnings` returns the warnings, which `ipcAutomation` logs with
    `logger.cloneWarnings` and still generates the bindings.
  - The walk follows aliases, interfaces (members, `extends`, merged declarations), generic
    arguments and type parameter constraints of the schema file, with a guard for recursive types.
    It does not follow imported types, qualified names or `typeof`, so those are never reported.
  - `Exclude`, `Extract`, `Omit`, `Pick`, `Parameters`, `ReturnType`, `InstanceType` and
    `ConstructorParameters` are skipped, since their result cannot be told without evaluating them.
    A conditional type is checked in its branches only. A `Promise` is an error in parameters only,
    and the `Promise` that makes a signature async is unwrapped in return types.
  - Applies to `port` and `send`/`emit` too, since they use the same algorithm. The error types of
    `invoke` are not checked: they travel in the error envelope of T18.
  - Existing fixtures that used function types only for their text were changed to equivalent
    cloneable ones (`param-clashes`, `name-collisions`).
  - `WeakRef` and the `Symbol` wrapper type are not checked; they were not in the scope.
