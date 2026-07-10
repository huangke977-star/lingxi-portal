# 灵犀门户 UI 重构实施计划

> **给智能执行员工：** 必须使用子技能：建议使用 `superpowers:subagent-driven-development`，或使用 `superpowers:executing-plans`，按任务逐项实施本计划。步骤使用复选框（`- [ ]`）语法便于跟踪。

**目标：** 把灵犀门户从 demo 风格改成统一的现代工作台界面。

**架构：** 前端保持 Next.js App Router 和原生 CSS。`layout.tsx` 提供全站 app shell，页面组件只负责各自内容，`globals.css` 提供共享设计系统、入口列表、表格、表单和弹窗样式。

**技术栈：** Next.js、React、TypeScript、CSS Modules 之外的全局 CSS、pnpm。

## 全局约束

- 不引入 Tailwind、shadcn/ui 或大型 UI 依赖。
- 不修改后端 API、数据库或部署配置。
- 管理后台功能必须保持可用：角色修改、启停、修改密码。
- 页面文案使用产品 UI 语言，不使用设计说明文字。
- 项目文档保持中英文双份。

---

## 任务 1：统一布局和设计系统

**文件：**
- 修改：`apps/web/src/app/layout.tsx`
- 修改：`apps/web/src/app/globals.css`

**步骤：**
- [ ] 把根布局改成 `.app-shell`，包含 `.sidebar` 和 `.content-shell`。
- [ ] 在侧边栏加入品牌、主导航和账号入口。
- [ ] 重写 CSS 变量：背景、前景、弱文字、边框、表面、强调色、成功色、危险色。
- [ ] 增加页面布局类：`.page-shell`、`.page-header`、`.content-grid`、`.workspace-grid`。
- [ ] 增加共享组件样式：按钮、表单、入口项、状态徽章、角色徽章、表格和弹窗。

## 任务 2：改造公开页和工作台

**文件：**
- 修改：`apps/web/src/app/page.tsx`
- 修改：`apps/web/src/app/dashboard/page.tsx`
- 修改：`apps/web/src/app/nav/page.tsx`
- 修改：`apps/web/src/app/tools/page.tsx`

**步骤：**
- [ ] 首页改成门户总览，展示三个核心入口和 API 状态。
- [ ] 工作台展示当前账号、角色境界、权限提示和可进入区域。
- [ ] 导航页加入静态公开入口列表。
- [ ] 工具箱页加入静态工具入口列表。

## 任务 3：改造登录、注册和管理后台

**文件：**
- 修改：`apps/web/src/app/login/page.tsx`
- 修改：`apps/web/src/app/register/page.tsx`
- 修改：`apps/web/src/app/admin/page.tsx`

**步骤：**
- [ ] 登录和注册页使用新的 `.auth-panel` 表单容器。
- [ ] 管理后台标题区、统计区、表格和操作按钮使用新的工作台样式。
- [ ] 保留“修改密码”弹窗逻辑，不增加删除按钮。

## 任务 4：验证、提交和部署

**文件：**
- 验证所有前端修改。

**步骤：**
- [ ] 运行 `pnpm --filter @lingxi/web lint`。
- [ ] 运行 `pnpm --filter @lingxi/web build`。
- [ ] 运行 `pnpm build`。
- [ ] 提交并推送。
- [ ] 等 GitHub Actions 构建镜像成功。
- [ ] 服务器只执行 pull 和 up，不在服务器 build。
- [ ] 验证 `https://5200918.xyz/` 和 `https://5200918.xyz/admin` 可访问。

## 自检说明

- 本计划只做视觉和布局重构。
- 数据层 CRUD、图标库、深色模式和 shadcn 迁移后续再做。
- 文档不包含真实凭据。
