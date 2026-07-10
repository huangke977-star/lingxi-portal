# HLOVET 玻璃卡片门户实施计划

> **给智能执行员工：** 必须使用子技能：建议使用 `superpowers:subagent-driven-development`，或使用 `superpowers:executing-plans`，按任务逐项实施本计划。步骤使用复选框（`- [ ]`）语法便于跟踪。

**目标：** 将站点改为 HLOVET 品牌和浅色磨砂卡片门户，并加入右上角登录/头像/等级徽章交互。

**架构：** 保持 Next.js App Router。`layout.tsx` 引入新的客户端 `TopNav` 组件；`TopNav` 从 localStorage 读取 token 并通过 `/auth/me` 获取用户信息。页面继续复用全局 CSS，不引入新的 UI 依赖。

**技术栈：** Next.js、React、TypeScript、全局 CSS、pnpm。

## 全局约束

- 页面可见品牌统一为 `HLOVET`。
- 不在门户导航、首页或普通工作台入口中展示后台管理入口。
- `/admin` 直接访问仍保留。
- 登录后顶部右侧显示等级徽章和头像。
- 悬浮等级徽章显示具体用户等级。
- 悬浮头像显示账户操作列表。
- 不修改后端 API、数据库或部署配置。
- 项目文档保持中英文双份。

---

## 任务 1：顶部导航和账号菜单

**文件：**
- 创建：`apps/web/src/components/top-nav.tsx`
- 修改：`apps/web/src/app/layout.tsx`

**步骤：**
- [ ] 创建 `TopNav` 客户端组件。
- [ ] 未登录时显示 `HLOVET`、导航、工具、工作台和右侧登录入口。
- [ ] 登录后读取 `/auth/me`，显示等级徽章和头像。
- [ ] 悬浮头像展示工作台、导航、工具箱和退出登录。
- [ ] 从顶部导航中移除管理后台入口。
- [ ] 在 `layout.tsx` 中使用 `TopNav`。

## 任务 2：玻璃卡片视觉系统

**文件：**
- 修改：`apps/web/src/app/globals.css`

**步骤：**
- [ ] 将全局布局改为顶部导航 + 主内容区域。
- [ ] 设置浅色磨砂背景、半透明卡片、柔和阴影和 hover 上浮。
- [ ] 增加账号菜单、等级徽章、头像、卡片网格和门户 hero 样式。
- [ ] 保留后台表格、表单和弹窗的可用样式。

## 任务 3：品牌和页面内容调整

**文件：**
- 修改：`apps/web/src/app/page.tsx`
- 修改：`apps/web/src/app/dashboard/page.tsx`
- 修改：`apps/web/src/app/nav/page.tsx`
- 修改：`apps/web/src/app/tools/page.tsx`
- 修改：`apps/web/src/app/login/page.tsx`
- 修改：`apps/web/src/app/register/page.tsx`
- 修改：`apps/web/src/app/admin/page.tsx`

**步骤：**
- [ ] 所有可见品牌从“灵犀门户 / Lingxi Portal”改为 `HLOVET`。
- [ ] 首页使用卡片式入口，不展示后台入口。
- [ ] 工作台入口列表不展示后台入口。
- [ ] 导航和工具箱使用卡片网格。
- [ ] 登录/注册使用居中磨砂卡片。
- [ ] 管理后台保留功能，但不加入门户导航。

## 任务 4：验证、提交和部署

**文件：**
- 验证所有前端修改。

**步骤：**
- [ ] 运行 `pnpm --filter @lingxi/web lint`。
- [ ] 运行 `pnpm --filter @lingxi/web build`。
- [ ] 运行 `pnpm build`。
- [ ] 使用 Edge 通道截图检查首页、移动端首页、登录页和管理页。
- [ ] 提交并推送。
- [ ] 等 GitHub Actions 镜像构建成功。
- [ ] 服务器只执行 pull 和 up，不在服务器 build。
- [ ] 验证 `https://5200918.xyz/`、`/login`、`/admin` 可访问。

## 自检说明

- 本计划只做前端品牌、布局和交互调整。
- 后台安全仍由后端 guard 决定，不依赖隐藏入口。
- 文档不包含真实凭据。
