# T81: Serializer for port, utility process and service worker channels

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in T37. The `serializer` of the config applies to the channels between a page and
  the main process only. `port` channels, the channels of utility processes (`callUtility`,
  `notifyUtility`, `callMain`, `notifyMain`, `invokeUtility`, `streamUtility`) and the channels of service
  workers carry their values with the structured clone algorithm, so a class instance loses its prototype
  there while it keeps it on a `invoke`.
- **Scope:**
  - Decide per transport whether the serializer applies, and apply it where it does, symmetrically at
    both ends: the two ends of a `port` channel (page to page, and main to page), the main process and the
    `utility.ts` file, the page and a utility process over the brokered port, and the main process and
    the preload script of a service worker.
  - The `utility.ts` file runs in a utility process that may not have the same module resolution, so
    decide how it gets the module of the config.
  - Keep `usesSerializer()` of the writer of the service worker script in step with what the hub of
    `main.ts` does.
  - Document what is covered in the README section on serializers.
- **Tests:** runtime round trips for each transport, and an e2e type-check.
- **Delivered:**
