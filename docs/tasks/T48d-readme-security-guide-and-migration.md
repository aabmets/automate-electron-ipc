# T48d: README security guide and migration notes

Phase 4: Developer experience. Split from [T48](./T48-readme-rewrite.md).
Status and dependencies are in the [roadmap](../roadmap.md).

- **Scope:** (edit only these sections; T48b and T48c own the others)
  - A "Security guide" section that gathers "Sender validation", "Scopes" and argument
    validation (`validate`) into one guide: the threat model (a compromised renderer), what the
    generated main bindings check by default, how to restrict a channel to windows/frames, how to
    validate arguments, and a checklist mapped to the Electron security checklist items it covers.
    Tag the examples as `readme-example`s (T48a harness).
  - Rewrite "Migrating from 0.2" into "Migrating from 0.2.x": every breaking change since 0.2.6
    (declaration syntax T00, config, output file names, header and stale files, `ChannelResult`
    vs. `ChannelReturn`), each with a before/after snippet. Get the list from `git log` and the
    task files' `Delivered:` notes, not from memory.
- **Tests:** the README example check passes.
- **Follow-up IDs:** T178-T179.
- **Delivered:**
