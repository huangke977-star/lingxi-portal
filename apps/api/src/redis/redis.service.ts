import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

export type RedisKeyType =
  "string" | "list" | "set" | "zset" | "hash" | "stream" | "none";

export interface RedisKeyMetadata {
  key: string;
  type: RedisKeyType;
  ttlSeconds: number;
  memoryBytes: number | null;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client = new Redis(
    process.env.REDIS_URL ?? "redis://localhost:6379",
    {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    },
  );

  async onModuleDestroy() {
    this.client.disconnect();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async info(): Promise<string> {
    return this.client.info();
  }

  async dbsize(): Promise<number> {
    return this.client.dbsize();
  }

  async scanKeys(
    cursor: string,
    pattern: string,
    count: number,
    type?: Exclude<RedisKeyType, "none">,
  ): Promise<[string, string[]]> {
    const args = ["MATCH", pattern, "COUNT", String(count)];
    if (type) {
      args.push("TYPE", type);
    }

    return (await this.client.call("SCAN", cursor, ...args)) as [
      string,
      string[],
    ];
  }

  async getKeyMetadata(keys: string[]): Promise<RedisKeyMetadata[]> {
    return Promise.all(
      keys.map(async (key) => {
        const [type, ttlSeconds, memoryUsage] = await Promise.all([
          this.client.type(key),
          this.client.ttl(key),
          this.client.call("MEMORY", "USAGE", key),
        ]);

        return {
          key,
          type: type as RedisKeyType,
          ttlSeconds,
          memoryBytes: memoryUsage === null ? null : Number(memoryUsage),
        };
      }),
    );
  }

  async set(
    key: string,
    value: string,
    expiresInSeconds?: number,
  ): Promise<void> {
    if (expiresInSeconds) {
      await this.client.set(key, value, "EX", expiresInSeconds);
      return;
    }

    await this.client.set(key, value);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async delMany(keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }

    return this.client.del(...keys);
  }

  async sadd(key: string, value: string): Promise<number> {
    return this.client.sadd(key, value);
  }

  async srem(key: string, value: string): Promise<number> {
    return this.client.srem(key, value);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async scard(key: string): Promise<number> {
    return this.client.scard(key);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async hlen(key: string): Promise<number> {
    return this.client.hlen(key);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lrange(key, start, stop);
  }

  async llen(key: string): Promise<number> {
    return this.client.llen(key);
  }

  async zrangeWithScores(
    key: string,
    start: number,
    stop: number,
  ): Promise<string[]> {
    return this.client.zrange(key, start, stop, "WITHSCORES");
  }

  async zcard(key: string): Promise<number> {
    return this.client.zcard(key);
  }

  async streamRange(key: string, count: number): Promise<unknown[]> {
    return (await this.client.call(
      "XRANGE",
      key,
      "-",
      "+",
      "COUNT",
      count,
    )) as unknown[];
  }

  async xlen(key: string): Promise<number> {
    return this.client.xlen(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }
}
