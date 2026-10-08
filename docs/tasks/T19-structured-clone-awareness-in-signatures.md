# T19: Structured-clone awareness in signatures

Phase 2: Core API, listener lifecycle and security.
Status and dependencies are in the [index](./README.md).

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
- **Delivered:**
