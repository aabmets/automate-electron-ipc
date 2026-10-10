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
- **Delivered:** 2026-10-10. The channel sections of the README are rewritten around one subsection per kind, under
"The Generated API": `invoke` (with Errors and Timeouts after it), `send`, `emit` (with the targets, `bind`
and `sendToSender`), `ask`, `stream` (with Backpressure), `port`, `mainPort` (with Bounded send queues),
Utility processes (the four `*Utility` and `*Main` verbs, and the brokered `invokeUtility` and
`streamUtility`) and Service workers. Each has the schema, the main-process code, the page code and an
untagged excerpt of the generated `main.ts` or `preload.ts` (or `utility.ts`), copied from a real run.
"Verbs" gained a table of the options of every verb. Every schema and usage example is a `readme-example`
(`kind-invoke`, `kind-send`, `kind-emit`, `kind-ask`, `kind-stream`, `kind-port`, `kind-main-port`,
`kind-queues`, `kind-backpressure`, `kind-errors`, `kind-timeouts`, `kind-window-handlers`,
`kind-utility`, `kind-utility-page`, `kind-service-worker`, `verbs`, `as-form`). The check learned one
convention: a file in an `sw` directory is the code of a service worker, and is checked with
`service-worker.d.ts` instead of `window.d.ts`, since both declare the global `ipc`. Checking the
examples found one stale claim: the `askWorker` example answered with an `async` responder although its
signature returned `number`; the signature returns a `Promise` now, and the `ask` text says that the
responder returns what the signature returns. No follow-up tasks (T174-T175 stay free). The sections
Sender validation and Scopes (T48d), and the preload and electron-vite sections (T48c), were not edited.
