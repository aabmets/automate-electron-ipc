/*
 *   MIT License
 *
 *   Copyright (c) 2024, Mattias Aabmets
 *
 *   The contents of this file are subject to the terms and conditions defined in the License.
 *   You may not use, modify, or distribute this file except in compliance with the License.
 *
 *   SPDX-License-Identifier: MIT
 */

import { LRUCache } from "@src/cache";
import { describe, expect, it } from "vitest";

describe("LRUCache", () => {
   it("should retrieve added elements", () => {
      const cache = new LRUCache(2);
      cache.put("a", 1);
      cache.put("b", 2);

      expect(cache.get("a")).toEqual([true, 1]);
      expect(cache.get("b")).toEqual([true, 2]);
   });

   it("should return false for missing keys", () => {
      const cache = new LRUCache(2);
      expect(cache.get("x")).toEqual([false, null]);
   });

   it("should evict the least recently used element when limit is exceeded", () => {
      const cache = new LRUCache(2);
      cache.put("a", 1);
      cache.put("b", 2);
      cache.put("c", 3); // should evict 'a'

      expect(cache.get("a")).toEqual([false, null]);
      expect(cache.get("b")).toEqual([true, 2]);
      expect(cache.get("c")).toEqual([true, 3]);
   });

   it("should update recently accessed elements to be the most recent", () => {
      const cache = new LRUCache(2);
      cache.put("a", 1);
      cache.put("b", 2);
      cache.get("a"); // 'a' becomes the most recent
      cache.put("c", 3); // should evict 'b' now

      expect(cache.get("a")).toEqual([true, 1]);
      expect(cache.get("b")).toEqual([false, null]);
      expect(cache.get("c")).toEqual([true, 3]);
   });

   it("should overwrite existing keys", () => {
      const cache = new LRUCache(2);
      cache.put("a", 1);
      cache.put("a", 2); // should overwrite 'a' with new value

      expect(cache.get("a")).toEqual([true, 2]);
   });

   it("should handle limit of 1 correctly", () => {
      const cache = new LRUCache(1);
      cache.put("a", 1);
      cache.put("b", 2); // should evict 'a' since limit is 1

      expect(cache.get("a")).toEqual([false, null]);
      expect(cache.get("b")).toEqual([true, 2]);
   });
});
