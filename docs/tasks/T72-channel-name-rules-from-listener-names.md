# T72: Channel name rules left over from the listener names

Phase 2: Core API, listener lifecycle and security.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found while delivering T13.
  - `validateChannelSpecs` requires a channel name of at least 3 characters that does not begin
    with `on` followed by a capital letter. Both rules came from the generated listener names
    (`on<Name>`, `send<Name>`), which no longer exist: a channel is now an object keyed by its
    name, so `ok`, `on` and `onReady` would be valid members.
  - The README still states the 3 character rule.
- **Scope:** decide which of the two rules still protect something (the key must stay a plain
  identifier, which the parser checks, and not clash with an object member, which T13 checks),
  drop the others from the validator and the README, and keep the lowercase-first rule only if the
  later naming tasks (T20) need it.
- **Tests:** validator tests for the names that are now accepted; the e2e type-check of a schema
  that uses them.
- **Delivered:** 2026-10-08. Notes:
  - All three rules are gone: the 3 character minimum, the `on` + capital ban and the lowercase-first
    rule. Nothing needs them: the writers emit the name as an object key and in string literals, the
    wire name is made unique by `channelPrefix` (T20), and T13 already rejects the members that every
    object has.
  - The validator now checks that the name is an ECMAScript identifier name (Unicode-aware, so
    `getÜser` stays valid), since the name is emitted as a bare object key. The parser already
    accepts only plain identifier keys.
  - `ok`, `on`, `onReady`, `Capital`, `_hidden` and `$dollar` generate and type-check (`short-names`
    fixture). The README no longer states the 3 character rule.
