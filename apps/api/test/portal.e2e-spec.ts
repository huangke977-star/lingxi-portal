import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";

const roles = [
  { id: 1, code: "qi_refining", name: "练气", level: 10 },
  { id: 2, code: "foundation_building", name: "筑基", level: 20 },
  { id: 9, code: "administrator", name: "管理员", level: 90 },
];

const userDefaults = {
  nickname: "测试用户",
  email: "test@example.com",
  status: "active",
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
  profileBio: "我懒，我不写",
  createdAt: new Date("2026-07-16T00:00:00.000Z"),
};

const users = [
  {
    ...userDefaults,
    id: 1,
    username: "superadmin",
    nickname: "超级管理员",
    email: "super@example.com",
    isSuperAdmin: true,
    role: roles[2],
  },
  {
    ...userDefaults,
    id: 2,
    username: "administrator",
    nickname: "管理员",
    email: "administrator@example.com",
    isSuperAdmin: false,
    role: roles[2],
  },
  {
    ...userDefaults,
    id: 3,
    username: "normal",
    email: "normal@example.com",
    isSuperAdmin: false,
    role: roles[0],
  },
];

interface StoredEntry {
  id: number;
  categoryId: number;
  title: string;
  description: string;
  url: string | null;
  iconPath: string | null;
  openInNewTab: boolean;
  visibility: "public" | "authenticated" | "role_restricted";
  sortOrder: number;
  status: "active" | "disabled";
  allowedRoleIds: number[];
  createdAt: Date;
  updatedAt: Date;
}

interface StoredCategory {
  id: number;
  kind: "navigation" | "tool" | "server" | "custom_page";
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  status: "active" | "disabled";
  createdAt: Date;
  updatedAt: Date;
}

interface PortalEntryWriteData {
  categoryId: number;
  title: string;
  description: string;
  url: string | null;
  iconPath: string | null;
  openInNewTab: boolean;
  visibility: StoredEntry["visibility"];
  sortOrder: number;
  status: StoredEntry["status"];
  allowedRoles?: {
    create?: Array<{ roleId: number }>;
  };
}

function createPrismaMock() {
  const now = new Date("2026-07-16T00:00:00.000Z");
  const categories: StoredCategory[] = [
    {
      id: 1,
      kind: "navigation",
      name: "公开导航",
      slug: "navigation",
      description: "",
      sortOrder: 10,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 2,
      kind: "tool",
      name: "工具",
      slug: "tools",
      description: "",
      sortOrder: 20,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 3,
      kind: "server",
      name: "服务器入口",
      slug: "servers",
      description: "",
      sortOrder: 30,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  ];
  const entries: StoredEntry[] = [
    {
      id: 1,
      categoryId: 1,
      title: "公开链接",
      description: "",
      url: "https://example.com",
      iconPath: null,
      openInNewTab: true,
      visibility: "public",
      sortOrder: 10,
      status: "active",
      allowedRoleIds: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 2,
      categoryId: 2,
      title: "登录工具",
      description: "",
      url: null,
      iconPath: null,
      openInNewTab: false,
      visibility: "authenticated",
      sortOrder: 10,
      status: "active",
      allowedRoleIds: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 3,
      categoryId: 2,
      title: "练气工具",
      description: "",
      url: null,
      iconPath: null,
      openInNewTab: false,
      visibility: "role_restricted",
      sortOrder: 20,
      status: "active",
      allowedRoleIds: [1],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 4,
      categoryId: 3,
      title: "内部面板",
      description: "",
      url: "https://server.example.com",
      iconPath: null,
      openInNewTab: true,
      visibility: "authenticated",
      sortOrder: 10,
      status: "active",
      allowedRoleIds: [],
      createdAt: now,
      updatedAt: now,
    },
  ];

  const withRoles = (entry: StoredEntry) => ({
    ...entry,
    allowedRoles: entry.allowedRoleIds.map((roleId) => ({
      role: roles.find((role) => role.id === roleId),
    })),
  });
  const withEntries = (
    category: StoredCategory,
    activeEntriesOnly = false,
  ) => ({
    ...category,
    entries: entries
      .filter((entry) => entry.categoryId === category.id)
      .filter((entry) => !activeEntriesOnly || entry.status === "active")
      .sort(
        (left, right) => left.sortOrder - right.sortOrder || left.id - right.id,
      )
      .map(withRoles),
  });

  const portalCategory = {
    findMany: jest.fn(
      async (args: {
        where?: { status?: string };
        select?: { entries?: { where?: { status?: string } } };
      }) =>
        categories
          .filter(
            (category) =>
              !args.where?.status || category.status === args.where.status,
          )
          .sort(
            (left, right) =>
              left.sortOrder - right.sortOrder || left.id - right.id,
          )
          .map((category) =>
            withEntries(
              category,
              args.select?.entries?.where?.status === "active",
            ),
          ),
    ),
    findUnique: jest.fn(
      async ({ where }: { where: { id: number } }) =>
        categories.find((category) => category.id === where.id) ?? null,
    ),
    create: jest.fn(
      async ({
        data,
      }: {
        data: Omit<StoredCategory, "id" | "createdAt" | "updatedAt">;
      }) => {
        const category: StoredCategory = {
          id: Math.max(...categories.map((item) => item.id), 0) + 1,
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        categories.push(category);
        return withEntries(category);
      },
    ),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: number };
        data: Partial<StoredCategory>;
      }) => {
        const category = categories.find((item) => item.id === where.id);
        if (!category) throw new Error("Category not found");
        Object.assign(category, data, { updatedAt: now });
        return withEntries(category);
      },
    ),
    delete: jest.fn(async ({ where }: { where: { id: number } }) => {
      const index = categories.findIndex((item) => item.id === where.id);
      if (index < 0) throw new Error("Category not found");
      return categories.splice(index, 1)[0];
    }),
  };

  const portalEntry = {
    count: jest.fn(
      async ({ where }: { where: { categoryId: number } }) =>
        entries.filter((entry) => entry.categoryId === where.categoryId).length,
    ),
    findMany: jest.fn(async ({ where }: { where: { categoryId: number } }) =>
      entries
        .filter((entry) => entry.categoryId === where.categoryId)
        .map((entry) => ({ id: entry.id })),
    ),
    findUnique: jest.fn(async ({ where }: { where: { id: number } }) => {
      const entry = entries.find((item) => item.id === where.id);
      return entry ? withRoles(entry) : null;
    }),
    create: jest.fn(async ({ data }: { data: PortalEntryWriteData }) => {
      const entry: StoredEntry = {
        id: Math.max(...entries.map((item) => item.id), 0) + 1,
        categoryId: data.categoryId,
        title: data.title,
        description: data.description,
        url: data.url,
        iconPath: data.iconPath,
        openInNewTab: data.openInNewTab,
        visibility: data.visibility,
        sortOrder: data.sortOrder,
        status: data.status,
        allowedRoleIds: (data.allowedRoles?.create ?? []).map(
          (item: { roleId: number }) => item.roleId,
        ),
        createdAt: now,
        updatedAt: now,
      };
      entries.push(entry);
      return withRoles(entry);
    }),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: number };
        data: PortalEntryWriteData;
      }) => {
        const entry = entries.find((item) => item.id === where.id);
        if (!entry) throw new Error("Entry not found");
        Object.assign(entry, {
          categoryId: data.categoryId,
          title: data.title,
          description: data.description,
          url: data.url,
          iconPath: data.iconPath,
          openInNewTab: data.openInNewTab,
          visibility: data.visibility,
          sortOrder: data.sortOrder,
          status: data.status,
          allowedRoleIds: (data.allowedRoles?.create ?? []).map(
            (item: { roleId: number }) => item.roleId,
          ),
          updatedAt: now,
        });
        return withRoles(entry);
      },
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: { in: number[] } };
        data: Partial<StoredEntry>;
      }) => {
        let count = 0;
        for (const entry of entries) {
          if (where.id.in.includes(entry.id)) {
            Object.assign(entry, data, { updatedAt: now });
            count += 1;
          }
        }
        return { count };
      },
    ),
    delete: jest.fn(async ({ where }: { where: { id: number } }) => {
      const index = entries.findIndex((item) => item.id === where.id);
      if (index < 0) throw new Error("Entry not found");
      return entries.splice(index, 1)[0];
    }),
  };
  const portalEntryRole = {
    deleteMany: jest.fn(
      async ({ where }: { where: { entryId: { in: number[] } } }) => {
        let count = 0;
        for (const entry of entries) {
          if (where.entryId.in.includes(entry.id)) {
            count += entry.allowedRoleIds.length;
            entry.allowedRoleIds = [];
          }
        }
        return { count };
      },
    ),
  };

  return {
    categories,
    entries,
    prisma: {
      portalCategory,
      portalEntry,
      portalEntryRole,
      role: {
        findMany: jest.fn(
          async (args?: { where?: { code?: { in?: string[] } } }) => {
            const codes = args?.where?.code?.in;
            return codes
              ? roles.filter((role) => codes.includes(role.code))
              : roles;
          },
        ),
      },
      user: {
        findUnique: jest.fn(
          async ({ where }: { where: { id: number } }) =>
            users.find((user) => user.id === where.id) ?? null,
        ),
      },
      $transaction: jest.fn(
        async (
          callback: (transaction: {
            portalCategory: typeof portalCategory;
            portalEntry: typeof portalEntry;
            portalEntryRole: typeof portalEntryRole;
          }) => unknown,
        ) => callback({ portalCategory, portalEntry, portalEntryRole }),
      ),
    },
  };
}

describe("portal content management (e2e)", () => {
  let app: INestApplication;
  let jwt: JwtService;
  let state: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = "test-access-token-secret";
    state = createPrismaMock();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(state.prisma)
      .overrideProvider(RedisService)
      .useValue({})
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
    if (!user) throw new Error(`Missing user ${userId}`);
    return jwt.signAsync(
      { sub: user.id, username: user.username },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: "15m" },
    );
  }

  it("returns only public non-server content to guests", async () => {
    const response = await request(app.getHttpServer())
      .get("/portal/public?kinds=navigation,tool,server")
      .expect(200);

    expect(response.body.categories).toHaveLength(1);
    expect(response.body.categories[0].kind).toBe("navigation");
    expect(
      response.body.categories[0].entries.map(
        (entry: { title: string }) => entry.title,
      ),
    ).toEqual(["公开链接"]);
  });

  it("filters restricted content by role and hides servers from administrators", async () => {
    const normalToken = await tokenFor(3);
    const normalResponse = await request(app.getHttpServer())
      .get("/portal/me?kinds=tool,server")
      .set("Authorization", `Bearer ${normalToken}`)
      .expect(200);
    expect(
      normalResponse.body.categories.map(
        (category: { kind: string }) => category.kind,
      ),
    ).toEqual(["tool"]);
    expect(
      normalResponse.body.categories[0].entries.map(
        (entry: { title: string }) => entry.title,
      ),
    ).toEqual(["登录工具", "练气工具"]);

    const administratorToken = await tokenFor(2);
    const administratorResponse = await request(app.getHttpServer())
      .get("/portal/me?kinds=server")
      .set("Authorization", `Bearer ${administratorToken}`)
      .expect(200);
    expect(administratorResponse.body.categories).toEqual([]);
  });

  it("returns server entries only to the super administrator", async () => {
    const token = await tokenFor(1);
    const response = await request(app.getHttpServer())
      .get("/portal/me?kinds=server")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body.categories).toHaveLength(1);
    expect(response.body.categories[0].entries[0].title).toBe("内部面板");
  });

  it("allows only the super administrator to manage content", async () => {
    const administratorToken = await tokenFor(2);
    await request(app.getHttpServer())
      .get("/portal/admin")
      .set("Authorization", `Bearer ${administratorToken}`)
      .expect(403);

    const superToken = await tokenFor(1);
    const categoryResponse = await request(app.getHttpServer())
      .post("/portal/admin/categories")
      .set("Authorization", `Bearer ${superToken}`)
      .send({
        kind: "server",
        name: "备用服务器",
        description: "内部入口",
        sortOrder: 40,
        status: "active",
      })
      .expect(201);

    const entryResponse = await request(app.getHttpServer())
      .post("/portal/admin/entries")
      .set("Authorization", `Bearer ${superToken}`)
      .send({
        categoryId: categoryResponse.body.id,
        title: "管理面板",
        description: "",
        url: "https://panel.example.com",
        iconPath: null,
        openInNewTab: true,
        visibility: "public",
        sortOrder: 10,
        status: "active",
        roleCodes: ["administrator"],
      })
      .expect(201);

    expect(entryResponse.body.visibility).toBe("authenticated");
    expect(entryResponse.body.allowedRoles).toEqual([]);

    const convertedCategoryResponse = await request(app.getHttpServer())
      .patch("/portal/admin/categories/2")
      .set("Authorization", `Bearer ${superToken}`)
      .send({ kind: "server" })
      .expect(200);
    expect(convertedCategoryResponse.body.kind).toBe("server");
    expect(
      convertedCategoryResponse.body.entries.every(
        (entry: { visibility: string; allowedRoles: unknown[] }) =>
          entry.visibility === "authenticated" &&
          entry.allowedRoles.length === 0,
      ),
    ).toBe(true);
  });
});
