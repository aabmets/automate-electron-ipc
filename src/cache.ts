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

/**
 * LRUCache is a Least Recently Used (LRU) cache that can be instantiated as a singleton
 * with a specified identifier, allowing retrieval of the same instance across the application
 * when provided with the same ID. It manages a limited number of entries and evicts the least
 * recently accessed items when the limit is reached. When the limit is set to 0, the cache size
 * is unlimited.
 *
 * Methods:
 * - getInstance(id: string, limit?: number): Returns an instance associated with the given ID.
 * - get(key: unknown): [boolean, unknown] - Retrieves a value by key if present, marking it as recently used.
 * - put(key: unknown, value: unknown): void - Inserts a key-value pair, evicting the least recently used item if necessary.
 */
export class LRUCache {
   private static instances: Map<string, LRUCache> = new Map();
   private readonly cache: Map<unknown, unknown>;
   private readonly limit: number;

   private constructor(limit = 0) {
      this.cache = new Map();
      this.limit = limit;
   }

   static getInstance(id: string, limit = 0): LRUCache {
      if (!LRUCache.instances.has(id)) {
         LRUCache.instances.set(id, new LRUCache(limit));
      }
      return LRUCache.instances.get(id) as LRUCache;
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
      } else if (this.limit > 0 && this.cache.size >= this.limit) {
         const leastRecentlyUsedKey = this.cache.keys().next().value;
         this.cache.delete(leastRecentlyUsedKey);
      }
      this.cache.set(key, value);
   }
}

export default { LRUCache };
