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

export class LRUCache {
   private readonly cache: Map<unknown, unknown>;
   private readonly limit: number;

   constructor(limit = 10) {
      this.cache = new Map();
      this.limit = limit;
   }

   get(key: unknown): [boolean, unknown] {
      if (!this.cache.has(key)) {
         return [false, null];
      }
      const value = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, value);
      return [true, value];
   }

   put(key: unknown, value: unknown): void {
      if (this.cache.has(key)) {
         this.cache.delete(key);
      } else if (this.cache.size >= this.limit) {
         const leastRecentlyUsedKey = this.cache.keys().next().value;
         this.cache.delete(leastRecentlyUsedKey);
      }
      this.cache.set(key, value);
   }
}

export default { LRUCache };
