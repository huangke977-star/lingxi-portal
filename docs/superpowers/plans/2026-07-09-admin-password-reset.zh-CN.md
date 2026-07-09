# 超级管理员修改用户密码实施计划

> **给智能执行员工：** 必须使用子技能：建议使用 `superpowers:subagent-driven-development`，或使用 `superpowers:executing-plans`，按任务逐项实施本计划。步骤使用复选框（`- [ ]`）语法便于跟踪。

**目标：** 让超级管理员可以在管理后台修改任意账号密码，同时保持没有删除用户入口。

**架构：** 后端在现有 `UsersModule` 中新增受 `SuperAdminGuard` 保护的密码更新接口，并复用 `PasswordService` 哈希密码。Web 端在现有 `/admin` 用户表格中加入密码修改弹窗，不新增删除能力。

**技术栈：** NestJS、Next.js、TypeScript、Prisma、bcryptjs、pnpm。

## 全局约束

- 只有 `isSuperAdmin = true` 的账号能修改任意用户密码。
- 普通 `administrator` 角色如果不是超级管理员，也不能修改密码。
- 密码最短 8 位。
- 响应体不得包含 `passwordHash`。
- 不新增删除接口，不新增删除按钮。
- 项目文档保持中英文双份。

---

## 任务 1：后端密码修改接口

**文件：**
- 创建：`apps/api/src/users/dto/update-user-password.dto.ts`
- 修改：`apps/api/src/users/users.controller.ts`
- 修改：`apps/api/src/users/users.service.ts`
- 修改：`apps/api/src/users/users.module.ts`
- 测试：`apps/api/test/users-admin.e2e-spec.ts`

**接口：**
- 输入：`PATCH /users/:id/password`，body 为 `{ password: string }`
- 输出：`AuthenticatedUser`

**步骤：**
- [ ] 在 `users-admin.e2e-spec.ts` 写失败测试：超级管理员可以修改用户密码，`passwordHash` 被更新且响应不包含 `passwordHash`。
- [ ] 运行 `pnpm --filter @lingxi/api test -- users-admin.e2e-spec.ts`，预期因为接口不存在而失败。
- [ ] 写失败测试：普通用户调用 `PATCH /users/1/password` 返回 403。
- [ ] 写失败测试：短密码调用接口返回 400。
- [ ] 创建 `UpdateUserPasswordDto`，使用 `@IsString()` 和 `@MinLength(8)` 校验 `password`。
- [ ] 在 `UsersService` 注入 `PasswordService`，新增 `updatePassword(id: number, password: string): Promise<AuthenticatedUser>`。
- [ ] 在 `UsersController` 新增 `@Patch(':id/password')` 路由。
- [ ] 在 `UsersModule` providers 中加入 `PasswordService`。
- [ ] 运行 `pnpm --filter @lingxi/api test -- users-admin.e2e-spec.ts`，预期通过。

## 任务 2：前端管理页按钮与弹窗

**文件：**
- 修改：`apps/web/src/lib/admin-api.ts`
- 修改：`apps/web/src/app/admin/page.tsx`
- 修改：`apps/web/src/app/globals.css`

**接口：**
- `updateUserPassword(accessToken: string, userId: number, password: string): Promise<AuthUser>`

**步骤：**
- [ ] 在 `admin-api.ts` 增加 `updateUserPassword`。
- [ ] 在 `/admin` 页面增加密码弹窗状态：目标用户、新密码、确认密码、提交状态。
- [ ] 在每行操作区增加“修改密码”按钮，不增加删除按钮。
- [ ] 保存前校验密码不少于 8 位、两次输入一致。
- [ ] 保存成功后关闭弹窗、清空输入、显示成功消息。
- [ ] 在 `globals.css` 增加操作按钮组、弹窗和弹窗表单样式。
- [ ] 运行 `pnpm --filter @lingxi/web lint`。
- [ ] 运行 `pnpm --filter @lingxi/web build`。

## 任务 3：全量验证、提交、部署

**文件：**
- 验证所有已修改文件。

**步骤：**
- [ ] 运行 `pnpm --filter @lingxi/api test`。
- [ ] 运行 `pnpm --filter @lingxi/api lint`。
- [ ] 运行 `pnpm --filter @lingxi/web lint`。
- [ ] 运行 `pnpm --filter @lingxi/web build`。
- [ ] 运行 `pnpm build`。
- [ ] 提交并推送。
- [ ] 等 GitHub Actions 镜像构建完成后，在服务器只执行 pull 和 up，不在服务器 build。
- [ ] 测试 `https://5200918.xyz/admin` 页面可登录、可看到修改密码按钮，且无删除按钮。

## 自检说明

- 覆盖了后端权限、密码校验、哈希保存、响应脱敏和前端操作入口。
- 明确排除了删除用户和普通用户自助改密码。
- 文档不包含真实账号密码。
