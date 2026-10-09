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
   CLAMPED_TIMEOUT,
   errorClassLines,
   MAX_TIMER_DELAY,
   replyReaderLines,
} from "@src/writer/generated-errors.js";
import { describe, expect, it } from "vitest";

const indents = ["   ", "      "];

describe("generated error class", () => {
   it("names the class and its default name", () => {
      const text = errorClassLines(indents, "IpcFooError").join("\n");
      expect(text).toContain("export class IpcFooError extends Error {");
      expect(text).toContain("name = 'IpcFooError'");
      expect(text).toContain("this.data = data;");
   });
});

describe("generated reply reader", () => {
   const options = {
      fn: "readFooReply",
      errorClass: "IpcFooError",
      invalidCode: "IPC_FOO_INVALID_REPLY",
      invalidMessage: "'Unreadable'",
      missingMessage: "'No message'",
   };

   it("builds the signature, the errors and their codes from the options", () => {
      const text = replyReaderLines(indents, options).join("\n");
      expect(text).toContain(
         "function readFooReply(channel: string, envelope: unknown): { value: unknown } | { error: IpcFooError } {",
      );
      expect(text).toContain("new IpcFooError(channel, 'Unreadable', 'IPC_FOO_INVALID_REPLY')");
      expect(text).toContain("error.message : 'No message';");
      expect(text).toContain("new IpcFooError(channel, message, code, name, error.data)");
   });

   it("adds the extra parameter after the envelope", () => {
      const text = replyReaderLines(indents, { ...options, extraParam: "who = 'x'" }).join("\n");
      expect(text).toContain("(channel: string, envelope: unknown, who = 'x'): {");
   });
});

describe("timer clamp", () => {
   it("keeps the delay within what setTimeout accepts", () => {
      expect(MAX_TIMER_DELAY).toBe(2 ** 31 - 1);
      expect(CLAMPED_TIMEOUT).toBe("Math.min(timeoutMs, 2147483647)");
   });
});
