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

import parser from "@src/parser";
import { describe, expect, it } from "vitest";

describe("isSignatureAssignment", () => {
   it("isSignatureAssignment should return true for valid signature assignments", () => {
      const validInputs = [
         "signature: type as (",
         "signature : type as(",
         "signature:type as(",
         "signature    :    type     as     (",
         "signature:\ttype as(", // Tabs as whitespace
         "signature:\ntype as(", // Newlines as whitespace
      ];
      validInputs.forEach((input) => {
         expect(parser.isSignatureAssignment(input)).toBe(true);
      });
   });

   it("isSignatureAssignment should return false for invalid signature assignments", () => {
      const invalidInputs = [
         "signatures: type as (", // Misspelled 'signature'
         "signature: types as (", // Misspelled 'type'
         "signature: typeas (", // Missing space between 'type' and 'as'
         "signature: type as )", // Wrong parenthesis
         "signature: type as", // Missing opening parenthesis
         " signature: type as (", // Leading space before 'signature'
         "signature type as(", // Missing colon
      ];
      invalidInputs.forEach((input) => {
         expect(parser.isSignatureAssignment(input)).toBe(false);
      });
   });
});

describe("isListenersAssignment", () => {
   it("isListenersAssignment should return true for valid listeners assignments", () => {
      const validInputs = [
         "listeners:[]",
         "listeners : [ ]",
         "listeners: ['event1']",
         "listeners:[ \"event1\", 'event2' ]",
         "listeners:['event1', \"event2\", event3 ]",
         "listeners:[ 'event1' , \"event2\", event3 ]",
         "listeners:['event1', \"event2\", event3]",
         'listeners: [ "event1", "event2", "event3" ]',
         "listeners:[\n'event1',\n\"event2\",\nevent3\n]", // Newlines within brackets
         "listeners:['event1',\t\"event2\",\tevent3]", // Tabs within brackets
         "listeners:[ ]", // Empty brackets with space
         "listeners:['event1', \"event2\", event3]", // No spaces
      ];
      validInputs.forEach((input) => {
         expect(parser.isListenersAssignment(input)).toBe(true);
      });
   });

   it("isListenersAssignment should return false for invalid listeners assignments", () => {
      const invalidInputs = [
         "listener: []", // Missing 's' in 'listeners'
         "listeners []", // Missing colon
         "listeners: [] extra", // Extra text after closing bracket
         'listeners: ["event1" ', // Missing closing bracket
         " listeners: []", // Leading space before 'listeners'
         "listeners: [{}]", // Invalid characters inside brackets
      ];
      invalidInputs.forEach((input) => {
         expect(parser.isListenersAssignment(input)).toBe(false);
      });
   });
});
