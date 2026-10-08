# T17: Runtime argument validation (Standard Schema)

Phase 2: Core API, listener lifecycle and security.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** renderer input is untrusted and TS types are erased at runtime.
- **Scope:**
  - Add a per-channel schema option `validate: SomeSchema`. It must be an identifier imported in the
    schema file, referencing a Standard Schema (`~standard`) for the argument tuple (zod, valibot,
    arktype, ...).
  - The generated `main.ts` value-imports it and validates before invoking the handler. On failure:
    Unicast rejects with `IpcValidationError` (with issues), Broadcast drops and reports to the hook.
  - In the generic form, `validate` is typed against `Parameters<Sig>` (set up in T00).
  - Out of scope: deriving the signature from the schema. A signature stays required on every
    channel.
  - Do not add a runtime dependency; use the spec only.
- **Tests:**
  - Parser tests for value-import detection.
  - Runtime tests with a hand-written Standard Schema stub: valid, invalid, async validator.
  - e2e type-check.
- **Delivered:** 2026-10-08. `invoke` and `send` take `validate: <identifier>`, which must be a named or default value import of the schema file (the parser rejects type-only and namespace imports, locals and expressions; the superstruct validator rejects it on `emit` and `port`). The public types add `StandardSchemaV1` (copied from the spec, no dependency) and type `validate` as a schema of `Parameters<S>`; the `as` form accepts any schema. The generated `main.ts` value-imports the validator (`ImportsGenerator.getValueImport`, which renames on collisions) and, when a channel has one, exports `IpcValidationError` and `IpcValidationIssue`. Each validated listener checks the sender, then calls `validateArguments` with the arguments as they arrived, and the callback gets the schema's output. Invoke throws the error, send drops; both go to `onRejected`, which now receives the error as a third argument in files with validators. A schema that throws, rejects or returns a non-array counts as a failure, with a generic message. Deviations: (1) a validated listener takes `...received: unknown[]` instead of the declared parameters, and calls the callback through a cast; (2) `once`/`handleOnce` use a `spent` flag, since an async schema lets two messages in before the first is accepted, and a late `handleOnce` call rejects with "No handler registered"; (3) `Array` and the validation names are reserved in `main.ts`. Follow-up: the renderer still sees only the message of the error; the typed envelope is T18.
