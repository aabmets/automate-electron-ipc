# T99: The README denies options that utility channels have

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found while delivering T86. The README says twice, in the sections on utility process
  channels and on brokered utility channels, that there are no `allowedOrigins`, `validate` or
  `timeoutMs` options yet. T79 added timeouts for utility calls, so at least part of it is stale.
- **Scope:** check which of those options the utility and brokered channels accept now, and make the
  two paragraphs say so. Documentation only, unless the check finds an option the README promises
  elsewhere but the code lacks; then add a task for it instead of fixing it here.
- **Tests:** none, beyond the e2e fixtures that already cover the options.
- **Delivered:**
