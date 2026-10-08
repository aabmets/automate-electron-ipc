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

import { LRUCache } from "@src/cache.js";
import { describe, expect, it } from "vitest";

describe("LRUCache Singleton Behavior", () => {
   it("should return the same instance for the same identifier", () => {
      const cache1 = LRUCache.getInstance("cache1", 2);
      const cache2 = LRUCache.getInstance("cache1", 2);

      expect(cache1).toBe(cache2); // Same instance for the same identifier
   });

   it("should return different instances for different identifiers", () => {
      const cache1 = LRUCache.getInstance("cache1", 2);
      const cache2 = LRUCache.getInstance("cache2", 2);

      expect(cache1).not.toBe(cache2); // Different instances for different identifiers
   });
});

describe("LRUCache Core Functionality", () => {
   it("should retrieve added elements", () => {
      const cache = LRUCache.getInstance("testCache1", 2);
      cache.put("a", 1);
      cache.put("b", 2);

      expect(cache.get("a")).toEqual([true, 1]);
      expect(cache.get("b")).toEqual([true, 2]);
   });

   it("should return false for missing keys", () => {
      const cache = LRUCache.getInstance("testCache2", 2);
      expect(cache.get("x")).toEqual([false, null]);
   });

   it("should evict the least recently used element when limit is exceeded", () => {
      const cache = LRUCache.getInstance("testCache3", 2);
      cache.put("a", 1);
      cache.put("b", 2);
      cache.put("c", 3); // should evict 'a'

      expect(cache.get("a")).toEqual([false, null]);
      expect(cache.get("b")).toEqual([true, 2]);
      expect(cache.get("c")).toEqual([true, 3]);
   });

   it("should update recently accessed elements to be the most recent", () => {
      const cache = LRUCache.getInstance("testCache4", 2);
      cache.put("a", 1);
      cache.put("b", 2);
      cache.get("a"); // 'a' becomes the most recent
      cache.put("c", 3); // should evict 'b' now

      expect(cache.get("a")).toEqual([true, 1]);
      expect(cache.get("b")).toEqual([false, null]);
      expect(cache.get("c")).toEqual([true, 3]);
   });

   it("should overwrite existing keys", () => {
      const cache = LRUCache.getInstance("testCache5", 2);
      cache.put("a", 1);
      cache.put("a", 2); // should overwrite 'a' with new value

      expect(cache.get("a")).toEqual([true, 2]);
   });

   it("should handle limit of 1 correctly", () => {
      const cache = LRUCache.getInstance("testCache6", 1);
      cache.put("a", 1);
      cache.put("b", 2); // should evict 'a' since limit is 1

      expect(cache.get("a")).toEqual([false, null]);
      expect(cache.get("b")).toEqual([true, 2]);
   });

   it("should allow unlimited growth when limit is 0", () => {
      const cache = LRUCache.getInstance("testCacheUnlimited");
      for (let i = 0; i < 1000; i++) {
         cache.put(`key${i}`, i);
      }

      expect(cache.get("key0")).toEqual([true, 0]);
      expect(cache.get("key999")).toEqual([true, 999]);
      expect(cache.get("key500")).toEqual([true, 500]);
   });
});
