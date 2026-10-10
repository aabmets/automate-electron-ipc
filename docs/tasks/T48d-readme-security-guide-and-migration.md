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
- **Delivered:** 2026-10-10. "Security guide" is a new `###` section after "Mocking in renderer tests":
  the threat model (script in the page, a frame that is not yours, a taken-over renderer process), a
  table of what the generated main bindings check without any option, "Sender validation", "Validating
  arguments" and "Scopes" (moved here with their old anchors, so the links from the service worker section
  hold), a worked example, and the Electron checklist items the library touches, by title, with the ones it
  has no part in named. The worked example is the `security-guide` example of the README example check; it
  caught a handler that was not `async` while it was written. "Migrating from 0.2" is now the `###` section
  "Migrating from 0.2.x" with sections for the schema (the `migration-schema` example is checked too), the
  generated names, config and CLI, generated files (header, stale files, `types.ts`, order, `ChannelResult` vs.
  `ChannelReturn`), changes in behavior and the package. The list comes from `git log` and the `Delivered:`
  notes of T00, T07, T10, T13 to T15, T18 to T20, T24, T38a, T38c, T42a, T42b, T43a, T44 and T72, and the
  0.2.6 sources (`git show 206943c`) for the "before" side; features that did not exist in 0.2.6 (utility
  processes, workers, scopes) are not breaking changes and are not listed. The bind/handle paragraph that
  sat in "Sender validation" moved to the start of "The Generated API". No follow-up work found.
