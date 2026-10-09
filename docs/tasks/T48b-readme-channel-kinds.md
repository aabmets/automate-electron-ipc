# T48b: README channel kinds with their generated output

Phase 4: Developer experience. Split from [T48](./T48-readme-rewrite.md).
Status and dependencies are in the [roadmap](../roadmap.md).

- **Scope:** rewrite the channel sections of the README ("Channel Maps" to "What Can Be Sent", and
  "The `as` Form"; T48c and T48d own the other sections, do not edit them):
  - One subsection per verb/channel kind (invoke, send, emit, ask, stream, port, utility process,
    service worker): the schema declaration, the generated main-process API, the generated
    renderer API, and a short excerpt of the generated code where it helps.
  - Errors, timeouts, backpressure and bounded queues stay, next to the kinds they apply to.
  - Every schema plus usage example is tagged as a `readme-example` (harness from T48a), so it is
    generated and type-checked in CI. Show generated-code excerpts as untagged blocks, copied from
    a real run.
- **Tests:** the README example check passes with the new examples.
- **Follow-up IDs:** T174-T175.
- **Delivered:**
