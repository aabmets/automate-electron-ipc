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
import { getCloneWarnings } from "@src/validation/clone-issues.js";
import { ChannelSpecGenerator } from "@testutils/validator-utils.js";
import * as t from "@types";
import { describe, expect, it } from "vitest";

describe("validateChannelSpecs, structured clone", () => {
   const issue = (patch: Partial<t.CloneIssue> = {}): t.CloneIssue => ({
      level: "error",
      where: "parameter 'cb'",
      type: "() => void",
      reason: "a function",
      ...patch,
   });
   const specWith = (...cloneIssues: t.CloneIssue[]): t.ChannelSpec => {
      const spec = new ChannelSpecGenerator().generate("RendererToMain", "Unicast");
      return { ...spec, name: "runTask", signature: { ...spec.signature, cloneIssues } };
   };

   it("throws for an error issue and names the channel, the place and the type", () => {
      expect(() => validateChannelSpecs([specWith(issue())])).toThrowError(
         "Channel 'runTask': parameter 'cb' contains a function ('() => void'). " +
            "It cannot be sent over IPC, and Electron throws 'An object could not be cloned'.",
      );
   });

   it("names the schema file and the local types that lead to the issue", () => {
      const spec = specWith(issue({ type: "symbol", reason: "a symbol", via: "Options → Key" }));
      expect(() => validateChannelSpecs([spec], "ipc/schema.ts")).toThrowError(
         "Schema file 'ipc/schema.ts': Channel 'runTask': parameter 'cb' contains a symbol " +
            "('symbol') through 'Options → Key'.",
      );
   });

   it("explains that only the result of invoke is a Promise", () => {
      const spec = specWith(issue({ type: "Promise<string>", reason: "a Promise" }));
      expect(() => validateChannelSpecs([spec])).toThrowError(
         "Only the result of an 'invoke' channel is a Promise, so send the resolved value.",
      );
   });

   it("explains that a Promise in a result is only allowed as the outermost type", () => {
      for (const where of ["return type", "chunk type"]) {
         const spec = specWith(issue({ where, type: "Promise<string>", reason: "a Promise" }));
         expect(() => validateChannelSpecs([spec])).toThrowError(
            `${where} contains a Promise ('Promise<string>'). It cannot be sent over IPC. ` +
               "Only the result of an async signature is a Promise, and only as the outermost type, " +
               "so await it and send the resolved value.",
         );
      }
   });

   it("reports every error issue, one per line", () => {
      const spec = specWith(
         issue(),
         issue({ where: "return type", type: "WeakMap<object, number>", reason: "a WeakMap" }),
      );
      let message = "";
      try {
         validateChannelSpecs([spec]);
      } catch (err) {
         message = (err as Error).message;
      }
      const lines = message.split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("parameter 'cb' contains a function");
      expect(lines[1]).toContain("return type contains a WeakMap ('WeakMap<object, number>')");
   });

   it.each(["Broadcast", "Unicast", "Port"] as const)("checks %s channels", (kind) => {
      const direction = kind === "Port" ? "RendererToRenderer" : "RendererToMain";
      const generated = new ChannelSpecGenerator().generate(direction, kind);
      const spec = { ...generated, signature: { ...generated.signature, cloneIssues: [issue()] } };
      expect(() => validateChannelSpecs([spec])).toThrowError(/contains a function/);
   });

   it("does not throw for a warning, and returns the spec", () => {
      const spec = specWith(
         issue({ level: "warning", type: "User", reason: "an instance of the class 'User'" }),
      );
      expect(validateChannelSpecs([spec])).toStrictEqual([spec]);
   });

   it("accepts a signature without issues", () => {
      expect(() => validateChannelSpecs([specWith()])).not.toThrowError();
   });

   it("rejects an issue with an unknown level", () => {
      const spec = specWith(issue({ level: "fatal" as never }));
      expect(() => validateChannelSpecs([spec])).toThrowError(/level must be/);
   });
});

describe("getCloneWarnings", () => {
   const warning: t.CloneIssue = {
      level: "warning",
      where: "parameter 'user'",
      type: "User",
      reason: "an instance of the class 'User'",
   };
   const specWith = (name: string, ...cloneIssues: t.CloneIssue[]): t.ChannelSpec => {
      const spec = new ChannelSpecGenerator().generate("RendererToMain", "Unicast");
      return { ...spec, name, signature: { ...spec.signature, cloneIssues } };
   };

   it("describes each warning with the file, the channel and the advice", () => {
      const warnings = getCloneWarnings([specWith("saveUser", warning)], "ipc/schema.ts");
      expect(warnings).toStrictEqual([
         "Schema file 'ipc/schema.ts': Channel 'saveUser': parameter 'user' contains an instance " +
            "of the class 'User' ('User'). An instance loses its prototype and methods over IPC " +
            "and arrives as a plain object. Use an interface or a type alias for the data.",
      ]);
   });

   it("leaves out the file when it is unknown, and the errors and clean channels", () => {
      const specs = [
         specWith("a", warning),
         specWith("b"),
         specWith("c", { ...warning, level: "error" }),
      ];
      const warnings = getCloneWarnings(specs);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].startsWith("Channel 'a': parameter 'user'")).toBe(true);
   });

   it("names the local types that lead to the class", () => {
      const warnings = getCloneWarnings([specWith("a", { ...warning, via: "Row" })]);
      expect(warnings[0]).toContain("('User') through 'Row'.");
   });
});
