import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisKeyType, RedisService } from "../src/redis/redis.service";

const users = [
  {
    id: 1,
    username: "admin",
    nickname: "HLOVET 主理人",
    email: "admin@example.com",
    status: "active",
    isSuperAdmin: true,
    role: { code: "administrator", name: "管理员", level: 90 },
  },
  {
    id: 2,
    username: "manager",
    nickname: "普通管理员",
    email: "manager@example.com",
    status: "active",
    isSuperAdmin: false,
    role: { code: "administrator", name: "管理员", level: 90 },
  },
] as const;

function authenticatedUserRecord(user: (typeof users)[number]) {
  return {
    ...user,
    appearanceThemeId: "sakura-mist",
    customAccent: "#db2777",
    customSurface: "#ffffff",
    customForeground: "#2b2530",
    customMuted: "#665867",
    cardAlpha: 52,
    glassBlur: 22,
    glassTint: "#fff3f6",
    glassTintAlpha: 72,
    avatarStoredName: null,
    avatarMimeType: null,
    profileBio: "保持简单。",
    createdAt: new Date("2026-07-16T00:00:00.000Z"),
  };
}

function createPrismaMock() {
  return {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: number } }) => {
        const user = users.find((item) => item.id === where.id);
        return user ? authenticatedUserRecord(user) : null;
      }),
    },
  };
}

function createRedisMock() {
  const strings = new Map<string, string>([
    [
      "refresh_token:token-a",
      JSON.stringify({
        userId: 2,
        tokenHash: "0123456789abcdef0123456789abcdef",
        issuedAt: "2026-07-16T00:00:00.000Z",
        expiresAt: "2026-08-15T00:00:00.000Z",
      }),
    ],
    ["login_fail:manager:1.2.3.4", "3"],
    [
      "business:greeting",
      JSON.stringify({ message: "hello", password: "must-not-leak" }),
    ],
  ]);
  const sets = new Map<string, Set<string>>([
    ["user_sessions:2", new Set(["token-a"])],
    ["business:api_tokens", new Set(["raw-secret-token-value"])],
  ]);
  const ttls = new Map<string, number>([
    ["refresh_token:token-a", 86_400],
    ["user_sessions:2", -1],
    ["login_fail:manager:1.2.3.4", 600],
    ["business:greeting", 3_600],
    ["business:api_tokens", 3_600],
  ]);

  function allKeys() {
    return [...new Set([...strings.keys(), ...sets.keys()])].sort();
  }

  function keyType(key: string): RedisKeyType {
    if (strings.has(key)) {
      return "string";
    }
    if (sets.has(key)) {
      return "set";
    }
    return "none";
  }

  const redis = {
    ping: jest.fn(async () => "PONG"),
    info: jest.fn(
      async () => `redis_version:7.2.5
uptime_in_seconds:3600
connected_clients:3
used_memory:1048576
used_memory_peak:2097152
maxmemory:134217728
mem_fragmentation_ratio:1.25
total_commands_processed:120
keyspace_hits:80
keyspace_misses:20
expired_keys:5
evicted_keys:0`,
    ),
    dbsize: jest.fn(async () => allKeys().length),
    scanKeys: jest.fn(
      async (
        cursor: string,
        pattern: string,
        count: number,
        type?: RedisKeyType,
      ) => {
        const search = pattern
          .replace(/^\*/, "")
          .replace(/\*$/, "")
          .replace(/\\(.)/g, "$1");
        const matching = allKeys().filter(
          (key) =>
            (!search || key.includes(search)) &&
            (!type || keyType(key) === type),
        );
        const start = Number(cursor);
        const keys = matching.slice(start, start + count);
        const nextCursor =
          start + count >= matching.length ? "0" : String(start + count);
        return [nextCursor, keys] as [string, string[]];
      },
    ),
    getKeyMetadata: jest.fn(async (keys: string[]) => {
      return keys.map((key) => ({
        key,
        type: keyType(key),
        ttlSeconds: ttls.get(key) ?? -2,
        memoryBytes: keyType(key) === "none" ? null : 128,
      }));
    }),
    get: jest.fn(async (key: string) => strings.get(key) ?? null),
    smembers: jest.fn(async (key: string) => [...(sets.get(key) ?? new Set())]),
    scard: jest.fn(async (key: string) => sets.get(key)?.size ?? 0),
    hgetall: jest.fn(async () => ({})),
    hlen: jest.fn(async () => 0),
    lrange: jest.fn(async () => []),
    llen: jest.fn(async () => 0),
    zrangeWithScores: jest.fn(async () => []),
    zcard: jest.fn(async () => 0),
    streamRange: jest.fn(async () => []),
    xlen: jest.fn(async () => 0),
    del: jest.fn(async (key: string) => {
      const existed = strings.delete(key) || sets.delete(key);
      ttls.delete(key);
      return existed ? 1 : 0;
    }),
    delMany: jest.fn(async (keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (strings.delete(key) || sets.delete(key)) {
          deleted += 1;
        }
        ttls.delete(key);
      }
      return deleted;
    }),
    srem: jest.fn(async (key: string, value: string) => {
      return sets.get(key)?.delete(value) ? 1 : 0;
    }),
    expire: jest.fn(async (key: string, seconds: number) => {
      if (keyType(key) === "none") {
        return 0;
      }
      ttls.set(key, seconds);
      return 1;
    }),
  };

  return { redis, sets, strings, ttls };
}

describe("cache administration (e2e)", () => {
  let app: INestApplication;
  let jwt: JwtService;
  let state: ReturnType<typeof createRedisMock>;

  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = "test-access-token-secret";
    state = createRedisMock();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(createPrismaMock())
      .overrideProvider(RedisService)
      .useValue(state.redis)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterEach(async () => {
    await app?.close();
  });

  async function tokenFor(userId: number): Promise<string> {
    const user = users.find((item) => item.id === userId);
    if (!user) {
      throw new Error(`Missing user ${userId}`);
    }
    return jwt.signAsync(
      { sub: user.id, username: user.username },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: "15m" },
    );
  }

  it("allows only the super administrator to access cache administration", async () => {
    const managerToken = await tokenFor(2);
    await request(app.getHttpServer())
      .get("/admin/cache/overview")
      .set("Authorization", `Bearer ${managerToken}`)
      .expect(403);
  });

  it("returns Redis metrics and scans matching keys", async () => {
    const token = await tokenFor(1);
    const overview = await request(app.getHttpServer())
      .get("/admin/cache/overview")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(overview.body).toMatchObject({
      connected: true,
      redisVersion: "7.2.5",
      keyCount: 5,
      usedMemoryBytes: 1_048_576,
      hitRate: 0.8,
    });

    const keys = await request(app.getHttpServer())
      .get("/admin/cache/keys?cursor=0&count=20&search=login_fail&type=string")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(keys.body.keys).toEqual([
      expect.objectContaining({
        key: "login_fail:manager:1.2.3.4",
        category: "login-failure",
        type: "string",
      }),
    ]);
  });

  it("defaults to ten keys and filters by cache category", async () => {
    const token = await tokenFor(1);
    state.redis.scanKeys
      .mockResolvedValueOnce(["7", []])
      .mockResolvedValueOnce(["0", ["user_sessions:2"]]);
    const keys = await request(app.getHttpServer())
      .get("/admin/cache/keys?category=user-sessions")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(keys.body.keys).toEqual([
      expect.objectContaining({
        key: "user_sessions:2",
        category: "user-sessions",
      }),
    ]);
    expect(state.redis.scanKeys).toHaveBeenNthCalledWith(
      1,
      "0",
      "user_sessions:*",
      10,
      undefined,
    );
    expect(state.redis.scanKeys).toHaveBeenNthCalledWith(
      2,
      "7",
      "user_sessions:*",
      10,
      undefined,
    );
  });

  it("redacts sensitive JSON fields before returning key values", async () => {
    const token = await tokenFor(1);
    const business = await request(app.getHttpServer())
      .post("/admin/cache/inspect")
      .set("Authorization", `Bearer ${token}`)
      .send({ key: "business:greeting" })
      .expect(200);
    expect(business.body.value).toEqual({
      message: "hello",
      password: "[sensitive value hidden]",
    });

    const refresh = await request(app.getHttpServer())
      .post("/admin/cache/inspect")
      .set("Authorization", `Bearer ${token}`)
      .send({ key: "refresh_token:token-a" })
      .expect(200);
    expect(refresh.body.value.tokenHash).toBe("012345...cdef");
    expect(JSON.stringify(refresh.body)).not.toContain(
      "0123456789abcdef0123456789abcdef",
    );

    const tokenSet = await request(app.getHttpServer())
      .post("/admin/cache/inspect")
      .set("Authorization", `Bearer ${token}`)
      .send({ key: "business:api_tokens" })
      .expect(200);
    expect(tokenSet.body.value).toEqual(["[sensitive value hidden]"]);
    expect(JSON.stringify(tokenSet.body)).not.toContain("raw-secret-token-value");
  });

  it("revokes refresh sessions and removes their user session index entry", async () => {
    const token = await tokenFor(1);
    const response = await request(app.getHttpServer())
      .post("/admin/cache/delete")
      .set("Authorization", `Bearer ${token}`)
      .send({ keys: ["refresh_token:token-a"] })
      .expect(200);

    expect(response.body).toMatchObject({ deletedKeys: 1, revokedSessions: 1 });
    expect(state.strings.has("refresh_token:token-a")).toBe(false);
    expect(state.sets.get("user_sessions:2")).toEqual(new Set());
  });

  it("revokes all sessions when deleting a user session index", async () => {
    const token = await tokenFor(1);
    const response = await request(app.getHttpServer())
      .post("/admin/cache/delete")
      .set("Authorization", `Bearer ${token}`)
      .send({ keys: ["user_sessions:2"] })
      .expect(200);

    expect(response.body).toMatchObject({ deletedKeys: 2, revokedSessions: 1 });
    expect(state.strings.has("refresh_token:token-a")).toBe(false);
    expect(state.sets.has("user_sessions:2")).toBe(false);
  });

  it("updates business cache TTL but protects authentication TTL values", async () => {
    const token = await tokenFor(1);
    const updated = await request(app.getHttpServer())
      .patch("/admin/cache/ttl")
      .set("Authorization", `Bearer ${token}`)
      .send({ key: "business:greeting", ttlSeconds: 600 })
      .expect(200);
    expect(updated.body.ttlSeconds).toBe(600);
    expect(state.ttls.get("business:greeting")).toBe(600);

    await request(app.getHttpServer())
      .patch("/admin/cache/ttl")
      .set("Authorization", `Bearer ${token}`)
      .send({ key: "refresh_token:token-a", ttlSeconds: 600 })
      .expect(400);

    const bulkUpdated = await request(app.getHttpServer())
      .patch("/admin/cache/ttl/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send({
        keys: ["business:greeting", "business:api_tokens"],
        ttlSeconds: 900,
      })
      .expect(200);
    expect(bulkUpdated.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "business:greeting", ttlSeconds: 900 }),
        expect.objectContaining({
          key: "business:api_tokens",
          ttlSeconds: 900,
        }),
      ]),
    );

    await request(app.getHttpServer())
      .patch("/admin/cache/ttl/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send({
        keys: ["business:greeting", "refresh_token:token-a"],
        ttlSeconds: 900,
      })
      .expect(400);
  });

  it("validates scan limits and bulk delete size", async () => {
    const token = await tokenFor(1);
    await request(app.getHttpServer())
      .get("/admin/cache/keys?count=101")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
    await request(app.getHttpServer())
      .get("/admin/cache/keys?category=unknown")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
    await request(app.getHttpServer())
      .post("/admin/cache/delete")
      .set("Authorization", `Bearer ${token}`)
      .send({ keys: Array.from({ length: 21 }, (_, index) => `key:${index}`) })
      .expect(400);
  });
});
