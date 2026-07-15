import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";

interface StoredUser {
  id: number;
  username: string;
  nickname: string;
  email: string;
  passwordHash: string;
  roleId: number;
  isSuperAdmin: boolean;
  status: "active" | "disabled";
  profileBio: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}

interface MockStringFilter {
  contains?: string;
}

interface MockUserWhere {
  AND?: MockUserWhere[];
  OR?: MockUserWhere[];
  nickname?: MockStringFilter;
  status?: StoredUser["status"];
  username?: MockStringFilter;
}

const roles = [
  { id: 1, code: "qi_refining", name: "练气", level: 10 },
  { id: 3, code: "golden_core", name: "金丹", level: 30 },
  { id: 9, code: "administrator", name: "管理员", level: 90 },
];

function createPrismaMock() {
  const users: StoredUser[] = [
    {
      id: 1,
      username: "admin",
      nickname: "HLOVET 主理人",
      email: "admin@example.com",
      passwordHash: "hash",
      roleId: 9,
      isSuperAdmin: true,
      status: "active",
      profileBio: "我懒，我不写",
      lastLoginAt: null,
      createdAt: new Date("2026-07-14T00:00:00.000Z"),
    },
    {
      id: 2,
      username: "normal",
      nickname: "云间来客",
      email: "normal@example.com",
      passwordHash: "hash",
      roleId: 1,
      isSuperAdmin: false,
      status: "active",
      profileBio: "我高冷，我不写。",
      lastLoginAt: null,
      createdAt: new Date("2026-07-14T00:00:00.000Z"),
    },
    {
      id: 3,
      username: "manager",
      nickname: "值守管理员",
      email: "manager@example.com",
      passwordHash: "hash",
      roleId: 9,
      isSuperAdmin: false,
      status: "active",
      profileBio: "保持简单。",
      lastLoginAt: null,
      createdAt: new Date("2026-07-14T00:00:00.000Z"),
    },
  ];
  const withRole = (user: StoredUser) => ({
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    email: user.email,
    passwordHash: user.passwordHash,
    status: user.status,
    isSuperAdmin: user.isSuperAdmin,
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
    profileBio: user.profileBio,
    createdAt: user.createdAt,
    role: roles.find((role) => role.id === user.roleId) ?? roles[0],
  });
  const matchesWhere = (user: StoredUser, where?: MockUserWhere): boolean => {
    if (!where) {
      return true;
    }

    if (
      where.AND &&
      !where.AND.every((condition) => matchesWhere(user, condition))
    ) {
      return false;
    }

    if (
      where.OR &&
      !where.OR.some((condition) => matchesWhere(user, condition))
    ) {
      return false;
    }

    if (where.status && user.status !== where.status) {
      return false;
    }

    if (
      where.username?.contains &&
      !user.username
        .toLowerCase()
        .includes(where.username.contains.toLowerCase())
    ) {
      return false;
    }

    if (
      where.nickname?.contains &&
      !user.nickname
        .toLowerCase()
        .includes(where.nickname.contains.toLowerCase())
    ) {
      return false;
    }

    return true;
  };

  return {
    users,
    prisma: {
      role: {
        findUnique: jest.fn(async ({ where }: { where: { code: string } }) => {
          return roles.find((role) => role.code === where.code) ?? null;
        }),
      },
      user: {
        count: jest.fn(async ({ where }: { where?: MockUserWhere }) => {
          return users.filter((user) => matchesWhere(user, where)).length;
        }),
        findMany: jest.fn(
          async ({
            where,
            skip = 0,
            take = users.length,
          }: {
            where?: MockUserWhere;
            skip?: number;
            take?: number;
          }) => {
            return users
              .filter((user) => matchesWhere(user, where))
              .slice(skip, skip + take)
              .map(withRole);
          },
        ),
        findUnique: jest.fn(async ({ where }: { where: { id?: number } }) => {
          const user = users.find((item) => item.id === where.id);
          return user ? withRole(user) : null;
        }),
        update: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id: number };
            data: Partial<StoredUser>;
          }) => {
            const user = users.find((item) => item.id === where.id);
            if (!user) {
              throw new Error("User not found");
            }

            Object.assign(user, data);
            return withRole(user);
          },
        ),
      },
    },
  };
}

describe("admin user management (e2e)", () => {
  let app: INestApplication;
  let jwt: JwtService;
  let state: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = "test-access-token-secret";
    process.env.JWT_ACCESS_EXPIRES_IN = "15m";

    state = createPrismaMock();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(state.prisma)
      .overrideProvider(RedisService)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterEach(async () => {
    await app?.close();
  });

  async function tokenFor(userId: number) {
    const user = state.users.find((item) => item.id === userId);
    if (!user) {
      throw new Error(`Missing user ${userId}`);
    }

    return jwt.signAsync(
      { sub: user.id, username: user.username },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: "15m" },
    );
  }

  it("allows super admin to list users without password hashes", async () => {
    const token = await tokenFor(1);

    const response = await request(app.getHttpServer())
      .get("/users")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      total: 3,
      activeCount: 3,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    expect(response.body.items).toHaveLength(3);
    expect(response.body.items[0]).toMatchObject({
      username: "admin",
      role: { code: "administrator", name: "超级管理员", level: 90 },
    });
    expect(response.body.items[0].passwordHash).toBeUndefined();
  });

  it("searches users by nickname or username", async () => {
    const token = await tokenFor(1);

    const nicknameResponse = await request(app.getHttpServer())
      .get("/users?search=云间")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(nicknameResponse.body.total).toBe(1);
    expect(
      nicknameResponse.body.items.map((user: StoredUser) => user.username),
    ).toEqual(["normal"]);

    const usernameResponse = await request(app.getHttpServer())
      .get("/users?search=mana")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(usernameResponse.body.total).toBe(1);
    expect(usernameResponse.body.items[0].nickname).toBe("值守管理员");
  });

  it("paginates user management results", async () => {
    const token = await tokenFor(1);
    for (let index = 4; index <= 13; index += 1) {
      state.users.push({
        id: index,
        username: `user${index}`,
        nickname: `用户 ${index}`,
        email: `user${index}@example.com`,
        passwordHash: "hash",
        roleId: 1,
        isSuperAdmin: false,
        status: "active",
        profileBio: "保持简单。",
        lastLoginAt: null,
        createdAt: new Date("2026-07-14T00:00:00.000Z"),
      });
    }

    const response = await request(app.getHttpServer())
      .get("/users?page=2&pageSize=10")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      total: 13,
      page: 2,
      pageSize: 10,
      totalPages: 2,
    });
    expect(response.body.items).toHaveLength(3);
    expect(response.body.items[0].username).toBe("user11");
  });

  it("allows super admin to assign roles", async () => {
    const token = await tokenFor(1);

    await request(app.getHttpServer())
      .patch("/users/2/role")
      .set("Authorization", `Bearer ${token}`)
      .send({ roleCode: "golden_core" })
      .expect(200);

    expect(state.users[1].roleId).toBe(3);
  });

  it("allows super admin to update user status", async () => {
    const token = await tokenFor(1);

    await request(app.getHttpServer())
      .patch("/users/2/status")
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "disabled" })
      .expect(200);

    expect(state.users[1].status).toBe("disabled");
  });

  it("allows super admin to reset other user nicknames", async () => {
    const token = await tokenFor(1);

    await request(app.getHttpServer())
      .patch("/users/2/nickname/reset")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(state.users[1].nickname).toBe("normal");
  });

  it("allows super admin to update user passwords without returning password hashes", async () => {
    const token = await tokenFor(1);
    const previousHash = state.users[1].passwordHash;

    const response = await request(app.getHttpServer())
      .patch("/users/2/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: "NewSecret123!" })
      .expect(200);

    expect(state.users[1].passwordHash).not.toBe(previousHash);
    expect(state.users[1].passwordHash).not.toBe("NewSecret123!");
    expect(response.body).toMatchObject({
      id: 2,
      username: "normal",
    });
    expect(response.body.passwordHash).toBeUndefined();
  });

  it("protects the super admin role and status", async () => {
    const token = await tokenFor(1);

    await request(app.getHttpServer())
      .patch("/users/1/role")
      .set("Authorization", `Bearer ${token}`)
      .send({ roleCode: "golden_core" })
      .expect(403);

    await request(app.getHttpServer())
      .patch("/users/1/status")
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "disabled" })
      .expect(403);
  });

  it("allows the super admin to update their own password", async () => {
    const token = await tokenFor(1);
    const previousHash = state.users[0].passwordHash;

    await request(app.getHttpServer())
      .patch("/users/1/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: "OwnSecret123!" })
      .expect(200);

    expect(state.users[0].passwordHash).not.toBe(previousHash);
  });

  it("allows administrators to list users", async () => {
    const token = await tokenFor(3);

    await request(app.getHttpServer())
      .get("/users")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
  });

  it("allows administrators to manage lower-level roles and status", async () => {
    const token = await tokenFor(3);

    await request(app.getHttpServer())
      .patch("/users/2/role")
      .set("Authorization", `Bearer ${token}`)
      .send({ roleCode: "golden_core" })
      .expect(200);

    await request(app.getHttpServer())
      .patch("/users/2/status")
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "disabled" })
      .expect(200);

    expect(state.users[1].roleId).toBe(3);
    expect(state.users[1].status).toBe("disabled");
  });

  it("allows administrators to reset lower-level nicknames", async () => {
    const token = await tokenFor(3);

    await request(app.getHttpServer())
      .patch("/users/2/nickname/reset")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(state.users[1].nickname).toBe("normal");
  });

  it("prevents administrators from assigning administrator roles", async () => {
    const token = await tokenFor(3);

    await request(app.getHttpServer())
      .patch("/users/2/role")
      .set("Authorization", `Bearer ${token}`)
      .send({ roleCode: "administrator" })
      .expect(403);
  });

  it("prevents administrators from changing same-level or super-admin accounts", async () => {
    const token = await tokenFor(3);

    await request(app.getHttpServer())
      .patch("/users/3/status")
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "disabled" })
      .expect(403);

    await request(app.getHttpServer())
      .patch("/users/1/role")
      .set("Authorization", `Bearer ${token}`)
      .send({ roleCode: "golden_core" })
      .expect(403);

    await request(app.getHttpServer())
      .patch("/users/1/nickname/reset")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("rejects administrators from updating user passwords", async () => {
    const token = await tokenFor(3);

    await request(app.getHttpServer())
      .patch("/users/2/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: "OtherSecret123!" })
      .expect(403);
  });

  it("rejects short password updates", async () => {
    const token = await tokenFor(1);

    await request(app.getHttpServer())
      .patch("/users/2/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: "short" })
      .expect(400);
  });

  it("rejects users below administrator level", async () => {
    const token = await tokenFor(2);

    await request(app.getHttpServer())
      .get("/users")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });
});
