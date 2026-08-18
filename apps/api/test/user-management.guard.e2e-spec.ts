import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { UserManagementGuard } from "../src/auth/guards/user-management.guard";

function context(user?: Partial<AuthenticatedUser>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe("UserManagementGuard", () => {
  const guard = new UserManagementGuard();

  it("allows administrators and super administrators into shared operations pages", () => {
    expect(guard.canActivate(context({ isSuperAdmin: false, isAdministrator: true, role: { code: "qi_refining", name: "练气", level: 10 } }))).toBe(true);
    expect(guard.canActivate(context({ isSuperAdmin: true, role: { code: "member", name: "成员", level: 10 } }))).toBe(true);
  });

  it("rejects ordinary users", () => {
    expect(() => guard.canActivate(context({ isSuperAdmin: false, isAdministrator: false, role: { code: "mahayana", name: "大乘", level: 80 } }))).toThrow(ForbiddenException);
  });
});
