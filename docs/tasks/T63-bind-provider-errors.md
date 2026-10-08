# T63: Errors thrown by `bind<X>` providers

Phase 1: Bug fixes.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found during T12. The generated `bind<X>(browserWindow, provider)` awaits the
  provider in the event listener without catching. A provider that throws or rejects surfaces as
  an unhandled rejection in the main process.
- **Scope:** catch provider errors in the generated listener, skip that send, and report the error
  through an optional `onError` callback of `bind<X>`, falling back to `console.error`. Keep the
  generated code free of any runtime dependency on this library.
- **Tests:** runtime tests of the generated `main.ts` (`tests/utils/runtime-utils.ts`): a throwing
  and a rejecting provider cause no unhandled rejection, call `onError`, and later events still
  send.
- **Delivered:**
