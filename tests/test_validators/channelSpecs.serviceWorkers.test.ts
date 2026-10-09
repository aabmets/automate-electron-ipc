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

import { validateChannelSpecs } from "@src/channel-validation.js";
import { ChannelSpecGenerator } from "@testutils/validator-utils.js";
import * as t from "@types";
import { describe, expect, it } from "vitest";

describe("validateChannelSpecs, service worker channels", () => {
   const generate = (direction: t.ChannelDirection, kind: t.ChannelKind, returnType = "void") =>
      new ChannelSpecGenerator().generate(direction, kind, returnType);

   it.each(["ServiceWorkerToMain", "MainToServiceWorker"] as const)(
      "accepts a Unicast channel %s with any return type, and a Broadcast one which returns void",
      (direction) => {
         for (const returnType of ["void", "number", "Promise<string>"]) {
            expect(() =>
               validateChannelSpecs([generate(direction, "Unicast", returnType)]),
            ).not.toThrowError();
         }
         for (const returnType of ["void", "Promise<void>"]) {
            expect(() =>
               validateChannelSpecs([generate(direction, "Broadcast", returnType)]),
            ).not.toThrowError();
         }
      },
   );

   it("rejects a Broadcast channel of a worker which returns a value", () => {
      expect(() =>
         validateChannelSpecs([generate("ServiceWorkerToMain", "Broadcast", "string")]),
      ).toThrowError("Channel return type 'string' not allowed when channel kind is 'Broadcast'");
   });

   it.each(["Port", "Stream"] as const)("rejects a %s channel with a worker direction", (kind) => {
      for (const direction of ["ServiceWorkerToMain", "MainToServiceWorker"] as const) {
         const spec = generate(direction, kind);
         expect(() => validateChannelSpecs([spec])).toThrowError(
            `Channel kind '${kind}' is not allowed when channel direction is '${direction}'.`,
         );
      }
   });

   it("accepts allowedOrigins and error types for the channels that a worker calls only", () => {
      const errors = { definition: "Error", customTypes: [] };
      const allowedOrigins = ["app://main"];
      for (const kind of ["Unicast", "Broadcast"] as const) {
         expect(() =>
            validateChannelSpecs([{ ...generate("ServiceWorkerToMain", kind), allowedOrigins }]),
         ).not.toThrowError();
         expect(() =>
            validateChannelSpecs([{ ...generate("MainToServiceWorker", kind), allowedOrigins }]),
         ).toThrowError(/allowedOrigins/);
      }
      expect(() =>
         validateChannelSpecs([{ ...generate("ServiceWorkerToMain", "Unicast"), errors }]),
      ).not.toThrowError();
      for (const direction of ["ServiceWorkerToMain", "MainToServiceWorker"] as const) {
         expect(() =>
            validateChannelSpecs([{ ...generate(direction, "Broadcast"), errors }]),
         ).toThrowError(/errors/);
      }
      expect(() =>
         validateChannelSpecs([{ ...generate("MainToServiceWorker", "Unicast"), errors }]),
      ).toThrowError(/errors/);
   });

   it("rejects an allowedOrigins list that holds no origin", () => {
      const spec = generate("ServiceWorkerToMain", "Unicast");
      expect(() => validateChannelSpecs([{ ...spec, allowedOrigins: [] }])).toThrowError(
         /at least one origin/,
      );
      expect(() =>
         validateChannelSpecs([{ ...spec, allowedOrigins: ["app://main/path"] }]),
      ).toThrowError(/is not an origin/);
   });

   it("accepts a validator for the channels that a worker calls only", () => {
      const validate = { name: "args", exported: "args", fromPath: "./v" };
      for (const kind of ["Unicast", "Broadcast"] as const) {
         expect(() =>
            validateChannelSpecs([{ ...generate("ServiceWorkerToMain", kind), validate }]),
         ).not.toThrowError();
         expect(() =>
            validateChannelSpecs([{ ...generate("MainToServiceWorker", kind), validate }]),
         ).toThrowError(/validate/);
      }
   });

   it("accepts a timeout for the calls of a worker only, not for its messages or questions", () => {
      expect(() =>
         validateChannelSpecs([{ ...generate("ServiceWorkerToMain", "Unicast"), timeoutMs: 5 }]),
      ).not.toThrowError();
      expect(() =>
         validateChannelSpecs([{ ...generate("ServiceWorkerToMain", "Unicast"), timeoutMs: -1 }]),
      ).toThrowError(/timeoutMs must be a non-negative integer/);
      for (const spec of [
         generate("ServiceWorkerToMain", "Broadcast"),
         generate("MainToServiceWorker", "Unicast"),
         generate("MainToServiceWorker", "Broadcast"),
      ]) {
         expect(() => validateChannelSpecs([{ ...spec, timeoutMs: 5 }])).toThrowError(/timeoutMs/);
      }
   });

   it("rejects the other options", () => {
      for (const direction of ["ServiceWorkerToMain", "MainToServiceWorker"] as const) {
         for (const kind of ["Unicast", "Broadcast"] as const) {
            for (const extra of [{ trigger: "focus" }, { maxQueue: 5 }, { scopes: ["a"] }]) {
               const [key] = Object.keys(extra);
               const spec = { ...generate(direction, kind), ...extra };
               expect(() => validateChannelSpecs([spec])).toThrowError(new RegExp(key));
            }
         }
      }
   });

   it("rejects a direction that no worker verb has", () => {
      const wrong = { ...generate("MainToServiceWorker", "Unicast"), direction: "ToServiceWorker" };
      expect(() => validateChannelSpecs([wrong as unknown as t.ChannelSpec])).toThrowError(
         /direction/,
      );
   });

   it("keeps the names of the worker channels unique among all channels", () => {
      const spec = generate("MainToServiceWorker", "Unicast");
      const clash = { ...generate("RendererToMain", "Broadcast"), name: spec.name };
      expect(() => validateChannelSpecs([spec, clash])).toThrowError(
         `Channel name '${spec.name}' is not unique across application.`,
      );
   });
});
