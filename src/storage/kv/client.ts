export class KVClient {
  constructor(private kv: KVNamespace) {}

  async get<T = unknown>(key: string): Promise<T | null> {
    const value = await this.kv.get(key, "text");
    if (value === null) return null;
    return JSON.parse(value) as T;
  }

  async getString(key: string): Promise<string | null> {
    return this.kv.get(key, "text");
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const options: KVNamespacePutOptions = {};
    if (ttlSeconds) {
      options.expirationTtl = ttlSeconds;
    }
    await this.kv.put(key, JSON.stringify(value), options);
  }

  async setString(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const options: KVNamespacePutOptions = {};
    if (ttlSeconds) {
      options.expirationTtl = ttlSeconds;
    }
    await this.kv.put(key, value, options);
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  async list(prefix?: string): Promise<string[]> {
    const result = await this.kv.list({ prefix });
    return result.keys.map((k) => k.name);
  }

  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }
}

export function createKVClient(kv: KVNamespace): KVClient {
  return new KVClient(kv);
}
