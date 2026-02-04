export class R2Client {
  constructor(private bucket: R2Bucket) {}

  async get(key: string): Promise<R2ObjectBody | null> {
    return this.bucket.get(key);
  }

  async getText(key: string): Promise<string | null> {
    const object = await this.bucket.get(key);
    if (object === null) return null;
    return object.text();
  }

  async getJson<T = unknown>(key: string): Promise<T | null> {
    const text = await this.getText(key);
    if (text === null) return null;
    return JSON.parse(text) as T;
  }

  async put(key: string, value: string | ArrayBuffer | ReadableStream, options?: R2PutOptions): Promise<R2Object> {
    return this.bucket.put(key, value, options);
  }

  async putJson<T = unknown>(key: string, value: T): Promise<R2Object> {
    return this.bucket.put(key, JSON.stringify(value), {
      httpMetadata: { contentType: "application/json" },
    });
  }

  async putText(key: string, value: string): Promise<R2Object> {
    return this.bucket.put(key, value, {
      httpMetadata: { contentType: "text/plain" },
    });
  }

  async putMarkdown(key: string, value: string): Promise<R2Object> {
    return this.bucket.put(key, value, {
      httpMetadata: { contentType: "text/markdown" },
    });
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async deleteMany(keys: string[]): Promise<void> {
    await this.bucket.delete(keys);
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    return this.bucket.list(options);
  }

  async listKeys(prefix?: string, limit?: number): Promise<string[]> {
    const result = await this.bucket.list({ prefix, limit });
    return result.objects.map((o) => o.key);
  }

  async exists(key: string): Promise<boolean> {
    const head = await this.bucket.head(key);
    return head !== null;
  }

  async head(key: string): Promise<R2Object | null> {
    return this.bucket.head(key);
  }
}

export function createR2Client(bucket: R2Bucket): R2Client {
  return new R2Client(bucket);
}
