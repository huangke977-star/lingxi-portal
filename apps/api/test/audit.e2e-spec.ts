import { CallHandler, ExecutionContext } from "@nestjs/common";
import { firstValueFrom, of } from "rxjs";
import { AuditInterceptor } from "../src/audit/audit.interceptor";
import { AuditService } from "../src/audit/audit.service";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";

function user(isSuperAdmin: boolean): AuthenticatedUser {
  return {
    id: isSuperAdmin ? 1 : 2,
    username: isSuperAdmin ? "admin" : "manager",
    nickname: isSuperAdmin ? "超级管理员" : "管理员",
    email: "user@example.com",
    status: "active",
    isSuperAdmin,
    avatarUrl: null,
    profileBio: "",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    appearance: {
      themeId: "sakura-mist",
      customAccent: "#db2777",
      customSurface: "#ffffff",
      customForeground: "#2b2530",
      customMuted: "#665867",
      cardAlpha: 52,
      glassBlur: 22,
      glassTint: "#fff3f6",
      glassTintAlpha: 72,
    },
    role: { code: "administrator", name: "管理员", level: 90 },
  };
}

describe("audit logs", () => {
  it("keeps administrators in business scope while super administrators can select server logs", async () => {
    const prisma = {
      auditLog: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
    };
    const service = new AuditService(prisma as unknown as PrismaService);

    await service.list({ page: 1, pageSize: 20, scope: "server" }, user(false));
    expect(prisma.auditLog.count).toHaveBeenLastCalledWith({ where: expect.objectContaining({ scope: "business" }) });

    await service.list({ page: 1, pageSize: 20, scope: "server" }, user(true));
    expect(prisma.auditLog.count).toHaveBeenLastCalledWith({ where: expect.objectContaining({ scope: "server" }) });
  });

  it("redacts passwords and tokens before persisting mutation metadata", async () => {
    const create = jest.fn(async () => undefined);
    const interceptor = new AuditInterceptor({ auditLog: { create } } as unknown as PrismaService);
    const request = {
      method: "PATCH",
      path: "/users/9",
      params: { id: "9" },
      query: { source: "admin" },
      body: {
        nickname: "新昵称",
        password: "plain-password",
        ossAccessKeyId: "plain-access-key",
        r2SecretAccessKey: "plain-secret-key",
        nested: { refreshToken: "plain-token" },
      },
      headers: { "user-agent": "audit-test", "x-forwarded-for": "203.0.113.7" },
      ip: "127.0.0.1",
      user: user(true),
    };
    const context = {
      getType: () => "http",
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as unknown as ExecutionContext;
    const next = { handle: () => of({ success: true }) } as CallHandler;

    await firstValueFrom(interceptor.intercept(context, next));
    await new Promise((resolve) => setImmediate(resolve));

    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: 1,
      action: "user.update",
      targetId: "9",
      metadata: {
        params: { id: "9" },
        query: { source: "admin" },
        body: {
          nickname: "新昵称",
          password: "[REDACTED]",
          ossAccessKeyId: "[REDACTED]",
          r2SecretAccessKey: "[REDACTED]",
          nested: { refreshToken: "[REDACTED]" },
        },
      },
    }) });
  });
});
