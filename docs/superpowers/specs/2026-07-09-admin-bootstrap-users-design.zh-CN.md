# 超级管理员初始化与用户管理设计

日期：2026-07-09

## 目标

在认证之后补上第一段管理能力：安全创建第一个超级管理员账号，并提供最小可用的 admin 用户管理界面，用于查看用户、调整角色、启用或禁用账号。

## 范围

本阶段包含：

- 一次性 CLI bootstrap 命令，用于创建或更新 `admin` 超级管理员账号。
- 通过环境变量传入 bootstrap 所需的用户名、邮箱和密码。
- 仅 admin 可用的用户列表、角色分配和用户状态修改 API。
- 后端 guard 必须要求 `isSuperAdmin = true`。
- `/admin` 前端页面接入真实用户管理 API，使用登录后保存的 access token。
- 覆盖 bootstrap、超级管理员 guard、用户列表、角色分配和状态修改的测试。

本阶段不包含：

- 修改公开注册流程。
- 找回密码。
- 用户自助编辑资料。
- 角色 CRUD。
- 服务器入口 CRUD。
- 导航、页面和工具管理。
- 在源码、文档或对话中保存密钥。

## 设计

bootstrap 命令运行在 API 包内，并尽量复用已有服务。它读取 `ADMIN_USERNAME`、`ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 环境变量，哈希密码，分配 `administrator` 角色，并设置 `isSuperAdmin = true`。命令必须幂等：如果用户名或邮箱已经存在，就把该用户更新为超级管理员，而不是创建重复账号。

用户管理 API 全部放在后端授权之后。`GET /users` 返回用户公开摘要和角色字段。`PATCH /users/:id/role` 接收角色 code 并更新用户角色。`PATCH /users/:id/status` 接收 `active` 或 `disabled` 并修改用户状态。只有超级管理员可以调用这些接口。

前端 `/admin` 保持安静、偏运维的工作台形态。页面读取本地 access token，加载当前用户；如果不是超级管理员，显示清晰的无权限状态；如果是超级管理员，加载角色和用户，并提供角色和状态控制。页面不展示也不保存密码。

## 安全规则

- bootstrap 密码只能来自环境变量或部署密钥。
- 命令不得打印密码或 token。
- API 授权必须在后端完成，不能只依赖前端隐藏按钮。
- 只有 `isSuperAdmin = true` 可以查看用户、分配角色或修改状态。
- 前端除了现有 access token 之外，不持久化任何 admin 专用密钥。

## 验收标准

- `pnpm --filter @lingxi/api admin:bootstrap` 在环境变量齐全时可以创建 `admin` 超级管理员。
- 重复运行 bootstrap 会更新已有 admin，而不是创建重复用户。
- 超级管理员可以查看用户列表、把用户分配到任意已初始化角色，并启用或禁用用户。
- 非超级管理员不能访问用户管理 API。
- `/admin` 使用真实 API，并展示可用的用户管理表格。
- API 测试、API lint、Web lint 和生产构建通过。
