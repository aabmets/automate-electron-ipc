# T12: Redesign `trigger` (B5)

Phase 1: Bug fixes.
Status and dependencies are in the [index](./README.md).

- **Problem:** with `trigger`, `send<X>(win, ...args)` registers a new `win.on(trigger)` listener on
  *every* call, never removes it, never sends immediately, and replays the arguments from the first
  call forever.
- **Scope:**
  - `send<X>` always sends immediately.
  - Triggers become a separate generated `bind<X>(win, provider: () => Args | Promise<Args>)`. It
    registers once, calls the provider on each trigger, and returns a disposer.
  - Validate trigger names against the documented BrowserWindow events list at generation time.
- **Tests:**
  - Regression: N calls produce 0 extra listeners.
  - The disposer removes the listener.
  - The provider is evaluated per event.
- **Delivered:**
