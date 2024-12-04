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

import parser from "@src/parser.js";
import { describe, expect, it } from "vitest";

describe("channelPattern", () => {
   it("should match valid channel patterns and extract correct groups", () => {
      const validInputs = [
         {
            input: 'Channel("CustomName1").Broadcast.RendererToMain',
            expected: {
               name: "CustomName1",
               kind: "Broadcast",
               direction: "RendererToMain",
            },
         },
         {
            input: 'Channel("AnyName2").Broadcast.MainToRenderer',
            expected: {
               name: "AnyName2",
               kind: "Broadcast",
               direction: "MainToRenderer",
            },
         },
         {
            input: "Channel('NamedChannel3').Unicast.RendererToRenderer",
            expected: {
               name: "NamedChannel3",
               kind: "Unicast",
               direction: "RendererToRenderer",
            },
         },
         {
            input: "Channel('OtherName4').Unicast.RendererToMain",
            expected: {
               name: "OtherName4",
               kind: "Unicast",
               direction: "RendererToMain",
            },
         },
      ];
      validInputs.forEach(({ input, expected }) => {
         const match = input.match(parser.channelPattern);
         expect(match).not.toBeNull();
         expect(match?.groups).toEqual(expected);
      });
   });

   it("should not match invalid channel patterns", () => {
      const invalidInputs = [
         'Channel("test")Broadcast.RendererToMain', // Missing dot before Broadcast
         'Channel("test").Unicast.RendererToOther', // Invalid direction
         'Channel("test").Multicast.RendererToMain', // Invalid kind
         'Channel("test").Broadcast', // Missing direction
         "Channel(test).Broadcast.RendererToMain", // Missing quotes around name
         'Channel("test").Broadcast.RendererToMainExtra', // Extra text at the end
         'Channel("test").Broadcast.RendererToMain.', // Trailing dot
         'Channel("test").Broadcast..RendererToMain', // Double dot
         'Channel("test").BroadcastRendererToMain', // Missing dot before direction
         'Channel("").Broadcast.RendererToMain', // Empty name
      ];

      invalidInputs.forEach((input) => {
         const match = input.match(parser.channelPattern);
         expect(match).toBeNull();
      });
   });

   it("should match names with underscores and numbers", () => {
      const input = 'Channel("user_123").Broadcast.RendererToMain';
      const match = input.match(parser.channelPattern);
      expect(match).not.toBeNull();
      expect(match?.groups?.name).toBe("user_123");
   });

   it("should not match names with special characters", () => {
      const input = 'Channel("user-name").Broadcast.RendererToMain';
      const match = input.match(parser.channelPattern);
      expect(match).toBeNull();
   });

   it("should be case-sensitive for kind and direction", () => {
      const input = 'Channel("test").broadcast.RendererToMain';
      const match = input.match(parser.channelPattern);
      expect(match).toBeNull();
   });
});
