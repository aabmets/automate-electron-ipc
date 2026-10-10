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

import { validateChannelSpecs } from "@src/validation/channel-validation.js";
import { ChannelSpecGenerator } from "@testutils/validator-utils.js";
import * as t from "@types";
import { describe, expect, it } from "vitest";

describe("validateChannelSpecs, allowedOrigins", () => {
   const make = (
      direction: t.ChannelDirection,
      kind: t.ChannelKind,
      allowedOrigins: unknown,
   ): Partial<t.ChannelSpec>[] => {
      const spec = new ChannelSpecGenerator().generate(direction, kind);
      return [{ ...spec, allowedOrigins } as Partial<t.ChannelSpec>];
   };

   it("accepts origins of Unicast and Broadcast channels from a renderer", () => {
      for (const kind of ["Unicast", "Broadcast"] as const) {
         const specs = make("RendererToMain", kind, [
            "app://.",
            "http://localhost:5173",
            "https://example.com",
            "file://",
            "https://[::1]:8080",
         ]);
         expect(() => validateChannelSpecs(specs)).not.toThrowError();
      }
   });

   it("accepts a channel without allowedOrigins", () => {
      const specs = [new ChannelSpecGenerator().generate("RendererToMain", "Unicast")];
      expect(() => validateChannelSpecs(specs)).not.toThrowError();
   });

   it("rejects allowedOrigins on MainToRenderer and Port channels", () => {
      for (const [direction, kind] of [
         ["MainToRenderer", "Broadcast"],
         ["RendererToRenderer", "Port"],
      ] as const) {
         const specs = make(direction, kind, ["app://."]);
         expect(() => validateChannelSpecs(specs)).toThrowError(/allowedOrigins/);
      }
   });

   it("rejects an empty list, since it would allow no caller", () => {
      const specs = make("RendererToMain", "Unicast", []);
      expect(() => validateChannelSpecs(specs)).toThrowError(/at least one origin/);
   });

   it.each([
      "*",
      "app://.*",
      "*.example.com",
      "https://*.example.com",
      "example.com",
      "localhost:5173",
      "http://localhost:5173/",
      "http://localhost:5173/index.html",
      "http://localhost:5173?x=1",
      "http://localhost:5173#x",
      "http://user:pass@example.com",
      "http://localhost:-1",
      "http://localhost:+80",
      "http://localhost:80:80",
      "HTTP://example.com",
      "http://EXAMPLE.com",
      "http://exa mple.com",
      " app://.",
      "null",
      "",
      "://host",
   ])("rejects '%s' as it is not an origin", (origin) => {
      const specs = make("RendererToMain", "Broadcast", ["app://.", origin]);
      expect(() => validateChannelSpecs(specs)).toThrowError(/is not an origin/);
   });

   it.each([
      "http://localhost:80",
      "https://example.com:443",
      "ws://localhost:80",
      "wss://localhost:443",
      "ftp://example.com:21",
      "http://localhost:080",
   ])(
      "rejects '%s', which has the default port of its scheme and so matches no origin",
      (origin) => {
         const specs = make("RendererToMain", "Unicast", ["app://.", origin]);
         expect(() => validateChannelSpecs(specs)).toThrowError(
            /has the default port of its scheme.*Write '[^']+'/,
         );
      },
   );

   it.each([
      "https://example.com:443x",
      "http://localhost:80a",
      "http://localhost:",
      "http://localhost:1e3",
      "http://localhost:0x50",
      "http://localhost:65536",
      "http://localhost:123456",
      "http://localhost:port",
      "http://[::1]:80x",
      "app://.:abc",
   ])("rejects '%s', whose port is not a number from 0 to 65535", (origin) => {
      // The pattern let a malformed port through.
      const specs = make("RendererToMain", "Unicast", ["app://.", origin]);
      expect(() => validateChannelSpecs(specs)).toThrowError(
         /which is not a number from 0 to 65535/,
      );
   });

   it("names the port that it refuses", () => {
      const specs = make("RendererToMain", "Unicast", ["https://example.com:443x"]);
      expect(() => validateChannelSpecs(specs)).toThrowError(
         "'https://example.com:443x' has the port '443x'",
      );
   });

   it.each([
      "http://localhost:0",
      "http://localhost:65535",
      "http://[::1]:5173",
      "http://[::1]",
      "http://127.0.0.1:3000",
      "app://main",
   ])("accepts the origin '%s'", (origin) => {
      const specs = make("RendererToMain", "Unicast", [origin]);
      expect(() => validateChannelSpecs(specs)).not.toThrowError();
   });

   it("names the origin without the port in the message", () => {
      const specs = make("RendererToMain", "Unicast", ["https://example.com:443"]);
      expect(() => validateChannelSpecs(specs)).toThrowError("Write 'https://example.com'");
   });

   it.each([
      "http://localhost:443",
      "https://example.com:80",
      "http://localhost:8080",
      "http://localhost:5173",
      "app://.:80",
   ])("keeps the origin '%s', whose port is not the default one of its scheme", (origin) => {
      const specs = make("RendererToMain", "Unicast", [origin]);
      expect(() => validateChannelSpecs(specs)).not.toThrowError();
   });

   it("rejects a default port in the origins of the channels that a worker calls", () => {
      const spec = new ChannelSpecGenerator().generate("ServiceWorkerToMain", "Unicast");
      expect(() =>
         validateChannelSpecs([{ ...spec, allowedOrigins: ["https://example.com:443"] }]),
      ).toThrowError(/default port/);
   });

   it("rejects a value which is not an array of strings", () => {
      for (const value of ["app://.", [1], { a: 1 }]) {
         const specs = make("RendererToMain", "Unicast", value);
         expect(() => validateChannelSpecs(specs)).toThrowError();
      }
   });
});

describe("validateChannelSpecs, validate", () => {
   const ref = { name: "idArgs", exported: "idArgs", fromPath: "./validators" };
   const make = (
      direction: t.ChannelDirection,
      kind: t.ChannelKind,
      validate: unknown,
   ): Partial<t.ChannelSpec>[] => {
      const spec = new ChannelSpecGenerator().generate(direction, kind);
      return [{ ...spec, validate } as Partial<t.ChannelSpec>];
   };

   it("accepts a validator on Unicast and Broadcast channels from a renderer", () => {
      for (const kind of ["Unicast", "Broadcast"] as const) {
         expect(() => validateChannelSpecs(make("RendererToMain", kind, ref))).not.toThrowError();
      }
   });

   it("accepts the default export of a package", () => {
      const specs = make("RendererToMain", "Unicast", {
         name: "schema",
         exported: "default",
         fromPath: "@scope/validators",
      });
      expect(() => validateChannelSpecs(specs)).not.toThrowError();
   });

   it("rejects validate on MainToRenderer and Port channels", () => {
      for (const [direction, kind] of [
         ["MainToRenderer", "Broadcast"],
         ["RendererToRenderer", "Port"],
      ] as const) {
         expect(() => validateChannelSpecs(make(direction, kind, ref))).toThrowError(/validate/);
      }
   });

   it.each([
      { ...ref, name: "not valid" },
      { ...ref, name: "" },
      { ...ref, exported: "a-b" },
      { ...ref, fromPath: "" },
      { name: "x" },
      "idArgs",
      null,
   ])("rejects the malformed reference %j", (value) => {
      expect(() => validateChannelSpecs(make("RendererToMain", "Unicast", value))).toThrowError();
   });
});
