import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Logger } from '@nestjs/common';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly namespace: string;
  private cachedKeys: Set<string> = new Set(); // Track keys we've cached

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private configService: ConfigService,
  ) {
    // Create a namespace based on environment to prevent key collisions
    this.namespace = `taskflow:${this.configService.get('NODE_ENV', 'development')}:`;
  }

  // Generates a namespaced key to prevent collisions

  private getNamespacedKey(key: string): string {
    if (!key || typeof key !== 'string') {
      throw new Error('Cache key must be a non-empty string');
    }
    return `${this.namespace}${key}`;
  }

  // Store a value in the cache with TTL

  async set(key: string, value: any, ttlSeconds = 300): Promise<void> {
    try {
      const namespacedKey = this.getNamespacedKey(key);

      // Clone complex objects to prevent unintended reference modifications
      const valueToStore =
        typeof value === 'object' && value !== null ? JSON.parse(JSON.stringify(value)) : value;

      await this.cacheManager.set(namespacedKey, valueToStore, ttlSeconds * 1000);

      // Track the key for later clearing
      this.cachedKeys.add(namespacedKey);

      this.logger.debug(`Cache set: ${namespacedKey} (TTL: ${ttlSeconds}s)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error setting cache key ${key}: ${errorMessage}`);
    }
  }

  // Retrieve a value from the cache

  async get<T>(key: string): Promise<T | null> {
    try {
      const namespacedKey = this.getNamespacedKey(key);
      const value = await this.cacheManager.get<T>(namespacedKey);

      // Deep clone the result to prevent caller from modifying cached data
      if (value !== null && value !== undefined && typeof value === 'object') {
        return JSON.parse(JSON.stringify(value)) as T;
      }

      return value as T;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error getting cache key ${key}: ${errorMessage}`);
      return null;
    }
  }

  // Delete a value from the cache

  async delete(key: string): Promise<boolean> {
    try {
      const namespacedKey = this.getNamespacedKey(key);
      await this.cacheManager.del(namespacedKey);

      // Remove from tracked keys
      this.cachedKeys.delete(namespacedKey);

      this.logger.debug(`Cache delete: ${namespacedKey}`);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error deleting cache key ${key}: ${errorMessage}`);
      return false;
    }
  }

  //Clear all values from the cache with the current namespace

  async clear(): Promise<void> {
    try {
      // Delete each tracked key
      const deletePromises = Array.from(this.cachedKeys).map(key =>
        this.cacheManager.del(key).catch(err => {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          this.logger.warn(`Failed to delete key ${key}: ${errorMessage}`);
        }),
      );

      await Promise.all(deletePromises);

      // Reset our tracking set
      this.cachedKeys.clear();

      this.logger.debug('Cache cleared');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error clearing cache: ${errorMessage}`);
    }
  }

  //Check if a key exists in the cache
  async has(key: string): Promise<boolean> {
    try {
      const namespacedKey = this.getNamespacedKey(key);
      const value = await this.cacheManager.get(namespacedKey);
      return value !== undefined && value !== null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error checking cache key ${key}: ${errorMessage}`);
      return false;
    }
  }

  // Set multiple cache keys at once
  async mset(entries: Array<[string, any]>, ttlSeconds = 300): Promise<void> {
    if (!Array.isArray(entries)) {
      throw new Error('Entries must be an array of key-value pairs');
    }

    // Process in parallel
    await Promise.all(entries.map(([key, value]) => this.set(key, value, ttlSeconds)));
  }

  // Get multiple cache keys at once
  async mget<T>(keys: string[]): Promise<Record<string, T | null>> {
    if (!Array.isArray(keys)) {
      throw new Error('Keys must be an array');
    }

    const results = await Promise.all(keys.map(async key => [key, await this.get<T>(key)]));

    return Object.fromEntries(results);
  }
}
