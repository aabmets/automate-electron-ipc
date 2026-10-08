# T30: Renderer ↔ utility process via a brokered port

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** the renderer cannot talk directly to a utility process, so every DB query hops through
  main.
- **Scope:**
  - The main brokers a `MessageChannelMain` between a window and a `UtilityProcess`.
  - The renderer gets typed invoke/stream calls over the port; the utility side gets handlers.
- **Tests:** runtime tests with mocks.
- **Delivered:**
