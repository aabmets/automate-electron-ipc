# T81b: Serializer for utility process channels

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in T37, split from T81. The channels of utility processes (`callUtility`,
  `notifyUtility`, `callMain`, `notifyMain`) and the channels between a page and a utility process over
  the brokered port (`invokeUtility`, `streamUtility`) carry their values with the structured clone
  algorithm, so a class instance loses its prototype there while it keeps it on an `invoke`.
- **Scope:**
  - Apply the serializer at both ends: the main process and the `utility.ts` file, and the page and
    `utility.ts` over the brokered port (arguments, results, chunks of a stream). The protocol of the
    peer is shared text in `utility-runtime.ts`, so it can serialize in `main.ts` and in `utility.ts`.
  - The `utility.ts` file runs in a utility process that may not have the same module resolution, so
    decide how it gets the module of the config, and say it in the README.
  - Failures: follow the rules of T37 and T81a (a call that is answered reports the error, a `send` that
    cannot be read is logged and dropped).
  - Update the README section on serializers.
- **Tests:** runtime round trips for each channel kind, and an e2e type-check; a real-Electron group.
- **Delivered:**
