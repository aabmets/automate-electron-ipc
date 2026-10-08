# T37: Custom serializers

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** `Date`, `Map` and class instances lose fidelity or prototype across IPC.
- **Scope:**
  - Optional config pointing at a module exporting `serialize`/`deserialize` (superjson-compatible
    shape).
  - Applied symmetrically in generated main and preload code.
  - Off by default.
- **Tests:** runtime round-trip tests.
- **Delivered:**
