# 超级管理员初始化与用户管理实施计划

> **给智能执行员工：** 必须使用子技能：建议使用 `superpowers:subagent-driven-development`，或使用 `superpowers:executing-plans`，按任务逐项实施本计划。步骤使用复选框（`- [ ]`）语法便于跟踪。

**目标：** 安全创建第一个超级管理员账号，并加入仅 admin 可用的用户角色和状态管理能力。

**架构：** API 新增 bootstrap 脚本，并扩展 `UsersModule`，通过 `SuperAdminGuard` 保护用户管理操作。Web 端把 `/admin` 占位页替换成客户端用户管理工作台，通过类型化 API helper 调用后端。

**技术栈：** NestJS、Next.js、TypeScript、Prisma、MySQL、Redis、pnpm。

## 全局约束

- 不打印、不提交、不写入真实 admin 密码。
- Bootstrap 输入来自 `ADMIN_USERNAME`、`ADMIN_EMAIL` 和 `ADMIN_PASSWORD`。
- 用户管理 API 必须要求 `isSuperAdmin = true`。
- 本阶段只做 bootstrap 和用户角色/状态管理。
- 项目文档保持中英文双份。

---

## 任务

### 任务 1：Bootstrap 命令

**文件：**
- 修改：`apps/api/package.json`
- 创建：`apps/api/prisma/bootstrap-admin.ts`
- 测试：`apps/api/test/admin-bootstrap.e2e-spec.ts`

**步骤：**
- [ ] 先写失败测试，证明 bootstrap 会创建 `isSuperAdmin` 用户并分配 `administrator` 角色，重复运行会更新同一用户。
- [ ] 实现 `bootstrap-admin.ts`，包含环境变量校验、密码哈希、角色查询、幂等创建/更新。
- [ ] 在 `apps/api/package.json` 增加 `admin:bootstrap` 脚本。
- [ ] 运行 `pnpm --filter @lingxi/api test -- admin-bootstrap.e2e-spec.ts`。
- [ ] 提交 `feat(api): add admin bootstrap command`。

### 任务 2：Admin 用户 API

**文件：**
- 修改：`apps/api/src/users/users.service.ts`
- 修改：`apps/api/src/users/users.module.ts`
- 创建：`apps/api/src/users/users.controller.ts`
- 创建：`apps/api/src/users/dto/update-user-role.dto.ts`
- 创建：`apps/api/src/users/dto/update-user-status.dto.ts`
- 创建：`apps/api/src/auth/guards/super-admin.guard.ts`
- 测试：`apps/api/test/users-admin.e2e-spec.ts`

**步骤：**
- [ ] 先写失败 e2e 测试，覆盖超级管理员查看用户、改角色、改状态，以及普通用户被拒绝。
- [ ] 实现 `SuperAdminGuard`。
- [ ] 添加 `UsersController` 路由：`GET /users`、`PATCH /users/:id/role`、`PATCH /users/:id/status`。
- [ ] 扩展 `UsersService`：`listUsers`、`assignRole`、`setStatus`。
- [ ] 运行 `pnpm --filter @lingxi/api test -- users-admin.e2e-spec.ts`。
- [ ] 提交 `feat(api): add admin user management`。

### 任务 3：Admin 前端界面

**文件：**
- 修改：`apps/web/src/lib/auth-api.ts`
- 创建：`apps/web/src/lib/admin-api.ts`
- 修改：`apps/web/src/app/admin/page.tsx`
- 修改：`apps/web/src/app/globals.css`

**步骤：**
- [ ] 增加用户、角色、角色更新、状态更新的类型化 admin API helper。
- [ ] 把 `/admin` 占位页替换为客户端超级管理员用户表格。
- [ ] 文案保持工具型，不展示密码或密钥。
- [ ] 运行 `pnpm --filter @lingxi/web lint` 和 `pnpm --filter @lingxi/web build`。
- [ ] 提交 `feat(web): add admin user management`。

### 任务 4：验证和服务器测试

**文件：**
- 修改：`README.md`

**步骤：**
- [ ] 在 README 记录 bootstrap 环境变量。
- [ ] 运行 `pnpm --filter @lingxi/api prisma:generate`。
- [ ] 运行 `pnpm --filter @lingxi/api test`。
- [ ] 运行 `pnpm --filter @lingxi/api lint`。
- [ ] 运行 `pnpm --filter @lingxi/web lint`。
- [ ] 运行 `pnpm build`。
- [ ] 推送 `main`。
- [ ] 使用已有私密凭据连接服务器，拉取仓库，执行迁移，用密钥环境变量运行 bootstrap，启动服务，并测试登录/admin API，不打印密钥。

## 自检说明

- 已覆盖：bootstrap、超级管理员 guard、用户列表、角色分配、状态修改、admin 界面、README 变量、本地与服务器验证。
- 有意延后：角色 CRUD、服务器入口 CRUD、导航/页面/工具管理、密码找回、邮箱验证。
- 本计划不包含任何真实凭据。
