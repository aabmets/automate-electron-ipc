/*
 *   Apache License 2.0
 *
 *   Copyright (c) 2024, Mattias Aabmets
 *
 *   The contents of this file are subject to the terms and conditions defined in the License.
 *   You may not use, modify, or distribute this file except in compliance with the License.
 *
 *   SPDX-License-Identifier: Apache-2.0
 */

import {
   all,
   askWorker,
   emitToWorker,
   invokeFromWorker,
   render,
   sendFromWorker,
} from "@testutils/writer/service-worker-writer-utils.js";
import { mockGetTargetFilePath } from "@testutils/writer/shared-mocks.js";
import { VitestMainBindingsWriter } from "@testutils/writer/test-writers.js";
import { describe, expect, it } from "vitest";

describe("MainBindingsWriter, service worker channels, timeouts", () => {
   mockGetTargetFilePath(VitestMainBindingsWriter);

   it("writes no timer without a timeout", async () => {
      const output = await render(all);
      for (const name of ["timeWorkerCall", "IPC_TIMEOUT", "info.timeoutMs"]) {
         expect(output).not.toContain(name);
      }
   });

   it("lists the timeout of each call that has one, the option first and else the default", async () => {
      const output = await render(
         [
            { ...invokeFromWorker, timeoutMs: 800 },
            { ...invokeFromWorker, name: "defaulted" },
            { ...invokeFromWorker, name: "patient", timeoutMs: 0 },
            sendFromWorker,
         ],
         { timeoutMs: 5000 },
      );

      expect(output).toContain(
         [
            "const workerCalls: WorkerChannelInfo[] = [",
            "   { channel: 'defaulted', wire: 'autoipc:defaulted', timeoutMs: 5000 },",
            "   { channel: 'getToken', wire: 'autoipc:getToken', timeoutMs: 800 },",
            "   { channel: 'patient', wire: 'autoipc:patient' },",
            "];",
         ].join("\n"),
      );
      expect(output).toContain("timeoutMs?: number;");
      expect(output).toContain(
         "function timeWorkerCall(info: WorkerChannelInfo, result: unknown): unknown {",
      );
      expect(output).toContain("'IpcTimeoutError'");
      expect(output).toContain("'IPC_TIMEOUT'");
      // The message has no timeout.
      expect(output).toContain("{ channel: 'syncDone', wire: 'autoipc:syncDone' },");
   });

   it("times the result of the handler inside the envelope", async () => {
      const output = await render([{ ...invokeFromWorker, timeoutMs: 800 }]);
      expect(output).toContain(
         "settleInvoke(() => timeWorkerCall(info, callWorkerHandler(hub, worker, event, info, args))),",
      );
   });

   it("times the result of the handler with rawErrors too", async () => {
      const output = await render([{ ...invokeFromWorker, timeoutMs: 800 }], {
         rawErrors: true,
      });
      expect(output).toContain(
         "timeWorkerCall(info, callWorkerHandler(hub, worker, event, info, args)),",
      );
      expect(output).not.toContain("settleInvoke(");
   });

   it("does not time a question to a worker, whatever the default is", async () => {
      const output = await render([askWorker, emitToWorker], { timeoutMs: 500 });
      expect(output).not.toContain("timeWorkerCall");
   });
});
