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
   invokeFromWorker,
   render,
   renderer,
   sendFromWorker,
} from "@testutils/writer/service-worker-writer-utils.js";
import mocks from "@testutils/writer/shared-mocks.js";
import shared from "@testutils/writer/writer-utils.js";
import { describe, expect, it } from "vitest";

describe("MainBindingsWriter, service worker channels, validation of the arguments", () => {
   mocks.mockGetTargetFilePath(shared.VitestMainBindingsWriter);

   const validate = { name: "idArgs", exported: "idArgs", fromPath: "./validators" };
   const validatedCall = { ...invokeFromWorker, params: ["id: number"], validate } as const;
   const validatedSend = {
      ...sendFromWorker,
      params: ["id: number"],
      validate: { ...validate, name: "lineArgs", exported: "lineArgs" },
   } as const;

   it("writes nothing for validation when no channel of a worker has a validator", async () => {
      const output = await render(all);
      for (const name of ["IpcValidationError", "validateArguments", "IpcArgumentsSchema"]) {
         expect(output).not.toContain(name);
      }
      expect(output).toContain(
         "onRejected?: (event: IpcMainServiceWorkerInvokeEvent | IpcMainServiceWorkerEvent, channel: string) => void;",
      );
      expect(output).toContain("workerConfig.onRejected(event, channel);");
      expect(output).toContain("const handler = hub.handlers[info.channel] as");
   });

   it("imports the validators and lists them in the tables of the channels", async () => {
      const output = await render([
         validatedCall,
         validatedSend,
         { ...invokeFromWorker, name: "plain" },
      ]);

      expect(output).toMatch(/^import \{ idArgs \} from "[^"]*validators";$/m);
      expect(output).toMatch(/^import \{ lineArgs \} from "[^"]*validators";$/m);
      expect(output).toContain(
         [
            "const workerCalls: WorkerChannelInfo[] = [",
            "   { channel: 'getToken', wire: 'autoipc:getToken', validator: idArgs },",
            "   { channel: 'plain', wire: 'autoipc:plain' },",
            "];",
         ].join("\n"),
      );
      expect(output).toContain(
         "   { channel: 'syncDone', wire: 'autoipc:syncDone', validator: lineArgs },",
      );
      expect(output).toContain("validator?: IpcArgumentsSchema;");
   });

   it("keeps the validator next to the allowed origins", async () => {
      const output = await render([{ ...validatedCall, allowedOrigins: ["app://main"] }]);
      expect(output).toContain(
         `   { channel: 'getToken', wire: 'autoipc:getToken', allowedOrigins: ["app://main"], validator: idArgs },`,
      );
   });

   it("declares the error, the schema types and a validation function for the worker events", async () => {
      const output = await render([validatedCall, validatedSend]);

      expect(output).toContain("export class IpcValidationError extends Error {");
      expect(output).toContain("function validateArguments<R>(");
      expect(output).toContain(
         "event: IpcMainServiceWorkerEvent | IpcMainServiceWorkerInvokeEvent,",
      );
      // A file without channels of pages has no hook of theirs, so the caller reports.
      expect(output).toContain(
         "report: (event: IpcMainServiceWorkerEvent | IpcMainServiceWorkerInvokeEvent, channel: string, error: IpcValidationError) => void,",
      );
      expect(output).toContain(
         "report(event as IpcMainServiceWorkerEvent | IpcMainServiceWorkerInvokeEvent, channel, error);",
      );
      expect(output).not.toContain("ipcConfig");
      expect(output).not.toContain("configureIpc");
   });

   it("types the events of the validated channels only", async () => {
      const output = await render([validatedCall]);
      expect(output).toContain("event: IpcMainServiceWorkerInvokeEvent,\n");
      expect(output).not.toContain("event: IpcMainServiceWorkerEvent,\n");
   });

   it("tells the hook why a call was rejected", async () => {
      const output = await render([validatedCall]);

      expect(output).toContain(
         "onRejected?: (event: IpcMainServiceWorkerInvokeEvent, channel: string, error: IpcWorkerError | IpcValidationError) => void;",
      );
      expect(output).toContain(
         "workerConfig.onRejected(event, channel, new IpcWorkerError(channel, `The service worker is not allowed to use the channel '${channel}'`, 'IPC_WORKER_FORBIDDEN'));",
      );
      expect(output).toContain(
         "(rejected, name, error) => workerConfig.onRejected?.(rejected, name, error)",
      );
   });

   it("rejects an invalid call after the sender check, and looks the handler up again", async () => {
      const output = await render([validatedCall]);

      expect(output).toMatch(
         /isWorkerAllowed\(worker, event, info\.channel, info\.allowedOrigins\)[\s\S]+?IPC_WORKER_FORBIDDEN[\s\S]+?const run = \(valid: unknown\[\]\): unknown => \{\n\s+const handler = hub\.handlers\[info\.channel\]/,
      );
      expect(output).toContain(
         "? validateArguments(event, info.channel, info.validator, args, false, run, ",
      );
      expect(output).toContain(": run(args);");
      expect(output).toContain("return handler(event, ...valid);");
   });

   it("drops an invalid message after the sender check, and looks the listeners up again", async () => {
      const output = await render([validatedSend]);

      expect(output).toContain("const run = (valid: unknown[]): void => {");
      expect(output).toContain(
         "void validateArguments(event, info.channel, info.validator, args, true, run, ",
      );
      expect(output).toContain(
         "(entry.callback as (...listenerArgs: unknown[]) => unknown)(event, ...valid);",
      );
   });

   it("validates in the handler call with rawErrors too, which leaves the rejection to Electron", async () => {
      const output = await render([validatedCall], { rawErrors: true });
      expect(output).toContain(
         "? validateArguments(event, info.channel, info.validator, args, false, run, ",
      );
      expect(output).toContain("callWorkerHandler(hub, worker, event, info, args),");
      expect(output).not.toContain("settleInvoke(");
   });

   it("serves a validated call and a plain message in one file", async () => {
      const output = await render([validatedCall, sendFromWorker]);
      // The messages are not validated, so their dispatcher has no run function.
      expect(output).toContain(
         "(entry.callback as (...listenerArgs: unknown[]) => unknown)(event, ...args);",
      );
      expect(output).not.toContain("void validateArguments(");
   });

   it("shares one validation function with the channels of the pages", async () => {
      const page = {
         ...renderer,
         params: ["id: number"],
         validate,
      } as const;
      const output = await render([page, validatedCall]);

      expect(output.match(/function validateArguments</g)).toHaveLength(1);
      expect(output).toContain("event: IpcMainInvokeEvent | IpcMainServiceWorkerInvokeEvent,");
      expect(output).toContain(
         "report?: (event: IpcMainServiceWorkerInvokeEvent, channel: string, error: IpcValidationError) => void,",
      );
      expect(output).toContain("if (report) {");
      expect(output).toContain(
         "ipcConfig.onRejected?.(event as IpcMainInvokeEvent, channel, error);",
      );
      // The hook of the pages does not see the events of the workers.
      expect(output).toContain(
         "onRejected?: (event: IpcMainInvokeEvent, channel: string, error: IpcForbiddenError | IpcValidationError) => void;",
      );
      // The page call is unchanged.
      expect(output).toContain("validateArguments(event, 'getUser', idArgs, received, false,");
   });
});
