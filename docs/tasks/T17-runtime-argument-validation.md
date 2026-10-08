# T17: Runtime argument validation (Standard Schema)

Phase 2: Core API, listener lifecycle and security.
Status and dependencies are in the [index](./README.md).

- **Problem:** renderer input is untrusted and TS types are erased at runtime.
- **Scope:**
  - Add a per-channel schema option `validate: SomeSchema`. It must be an identifier imported in the
    schema file, referencing a Standard Schema (`~standard`) for the argument tuple (zod, valibot,
    arktype, ...).
  - The generated `main.ts` value-imports it and validates before invoking the handler. On failure:
    Unicast rejects with `IpcValidationError` (with issues), Broadcast drops and reports to the hook.
  - In the generic form, `validate` is typed against `Parameters<Sig>` (set up in T00).
  - Optional: derive the TS signature from the schema's inferred input type when no signature is
    given.
  - Do not add a runtime dependency; use the spec only.
- **Tests:**
  - Parser tests for value-import detection.
  - Runtime tests with a hand-written Standard Schema stub: valid, invalid, async validator.
  - e2e type-check.
- **Delivered:**
