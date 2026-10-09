# T81c: Serializer for service worker channels

Phase 3: Missing Electron features.
Status and dependencies are in the [roadmap](../roadmap.md).

- **Problem:** found in T37, split from T81. The channels of service workers (`invokeFromWorker`,
  `sendFromWorker`, `emitToWorker`, `askWorker`) carry their values with the structured clone algorithm,
  so a class instance loses its prototype there while it keeps it on an `invoke`.
- **Scope:**
  - Apply the serializer between the main process and the preload script of a service worker: the hub
    of `main.ts` and the writer of `service-worker-preload.ts`. Keep `usesSerializer()` of that writer
    in step with what the hub does.
  - Keep the order of T37 in the hub: the sender check, then deserializing, then the `validate` schema.
  - Update the README section on serializers, which then covers every channel except the `data` of an
    error.
- **Tests:** runtime round trips for each channel kind, an e2e type-check, and a real-Electron group
  next to the service worker one.
- **Delivered:**
