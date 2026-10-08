# T00: New channel declaration syntax: a `defineChannels` map with verb helpers

Phase 0: Declaration syntax and test infrastructure.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Goal:** replace `Channel("X").<Direction>.<Kind>({ signature: type as Sig, ...rest })` with an
  exported channel map. The key is the channel name, a verb helper picks the pattern, and the
  signature is a type argument on the verb. That generic form is the main form.
  `verb(config?) as Sig` is also accepted as an alternative:
  ```ts
  import { defineChannels, invoke, send, emit, port } from "automate-electron-ipc";

  export default defineChannels({
     /** Doc comments are kept for later use in window.d.ts. */
     getUser: invoke<(id: number) => Promise<User>>({ timeoutMs: 5 }),
     echoUserName: send<(userName: string) => void>(),
     progress: emit<(n: number) => void>({ trigger: "focus" }),
     chat: port<(msg: string) => void>(),

     // Alternative `as` form, same result:
     getUserAlt: invoke({ timeoutMs: 5 }) as (id: number) => Promise<User>,
  });
  ```
  - The channel map is exported: `export default defineChannels({...})` or
    `export const <name> = defineChannels({...})`. Being exported, it is a real typed value that
    app code and generated code can `import type` from (T44).
  - Verbs replace the direction × kind grid: `invoke` = RendererToMain Unicast, `send` =
    RendererToMain Broadcast, `emit` = MainToRenderer Broadcast, `port` = RendererToRenderer Port.
    Later tasks add `ask` (T23), `stream` (T27) and the utility/service-worker verbs (T29, T36).
  - The generic form is the main form: TypeScript checks the config against the signature, and it
    is the only form that can carry error types (T18). The `as` form reads options-first, but its
    config is not checked against the signature.
  - This is breaking; bump to 1.0.0. The old syntax is removed, not kept alongside.
- **Scope:**
  - **`types/index.d.ts`:**
    - Each verb is `verb<S extends Fn = never>(config?: VerbConfig<NoInfer<S>>)`. It returns a
      branded `ChannelDef<S>` when `S` is given and `unknown` when it is not, so the `as` form
      type-checks.
    - Per-verb config interfaces: `trigger` only on `emit`. There is no `listeners` option (dropped,
      see T13).
      Options that depend on the signature (`validate` in T17) take `Parameters<S>` when `S` is
      given and are unconstrained when it is not.
    - `defineChannels<T extends Record<string, unknown>>(channels: T): T`.
    - Remove `Channel`, the `signature` config key and the `type` export.
    - Verified with tsc 7.0.2: both forms compile; a schema that does not match the generic
      signature is rejected; using both forms on one channel is rejected with TS2352.
    - Update the JSDoc examples.
  - **`src/index.ts`:** runtime stubs for `defineChannels` and the verbs, matching the new types.
  - **`src/parser.ts`:**
    - A schema file declares its channels in one exported channel map:
      `export default defineChannels({...})` or `export const <name> = defineChannels({...})`.
      Record which export it is, for T44. Resolve the verb and `defineChannels` names through the
      file's imports from `automate-electron-ipc`, so aliased imports work.
    - Each property is `name: verb<Sig>(config?)` or `name: verb(config?) as Sig` (unwrap
      parentheses). Either `TsFunctionType` provides the signature: params, return type, custom
      types, async.
    - Config keys (`trigger`) are read from the optional object-literal argument.
    - Errors, each naming the file and the channel:
      - no signature, or both a type argument and `as`;
      - a signature that is not a function type (TypeScript accepts `invoke() as string`);
      - an unknown verb, a spread, a computed or non-identifier key, or a nested object (reserved
        for T20/T33 groups);
      - an option that the verb does not support;
      - more than one `defineChannels` call in a file;
      - a `defineChannels` call that is not exported (not assigned, or assigned to a non-exported
        `const`);
      - a leftover `signature:` or `listeners:` key (reported as an unsupported option).
        Leftover `Channel(...)` statements are ignored. No migration messages: 1.0 is a breaking
        release.
    - Remove `channelPattern`, the `is*Assignment` helpers and all regex-on-source-text matching in
      favor of AST checks.
  - **`src/validators.ts`:** unchanged semantics. Map verbs to the existing kind/direction specs
    internally, so the writers do not change in this task.
  - **Tests:**
    - Rewrite all parser tests and test utils (`tests/test_parser/*`, `tests/utils/*`) to the new
      syntax.
    - Add cases for:
      - each verb, in both forms, with and without config;
      - a parenthesized `as` expression;
      - aliased imports;
      - default and named exports of the map;
      - async return;
      - rest, optional and destructured params;
      - each error case above.
    - A type-level test (tsc on a fixture) for the verified typing behavior above.
  - **README:** write every example in the generic form. Document the `as` form in one short
    section as an alternative, noting what it loses.
- **Delivered:** 2026-10-08. Notes:
  - Version is 1.0.0, not 0.3.0, and there are no migration messages or README migration section
    (decided after delivery: 1.0 is a breaking release).
  - Channel names are camelCase (decided after delivery): the validator now requires a lowercase
    first letter and still needs 3+ characters; only names that look like a listener (`onFoo`) are
    rejected. The generated 0.2-style members capitalize the key (`getUser` gives `sendGetUser` and
    `onGetUser`), so the writers' output is otherwise unchanged. T13 replaces these names.
  - `timeoutMs` in the example is T28's option and is not accepted yet (`invoke` has no options).
  - Parsing also accepts `import * as ns` namespace imports, and a map that is exported after
    assignment (`const m = defineChannels(...); export default m;` or `export { m }`).
  - `ChannelSpec.listeners` and its validation stay in the validators until T13 removes them; the
    parser never sets it. `SpecsCollection` gained `channelMapExport` for T44.
  - Test utils needed no change: they build specs directly and never used the old syntax.
  - Config interfaces keep a reserved, unused `_S` type parameter for T17's signature-dependent options.
