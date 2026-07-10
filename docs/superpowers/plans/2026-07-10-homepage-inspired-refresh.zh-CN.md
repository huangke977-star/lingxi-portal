# HLOVET Homepage 风格刷新实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 HLOVET 门户调整为参考 Homepage 的宽版、背景图磨砂和轻量入口模块体验。

**Architecture:** 只修改 Web 前端层。`TopNav` 负责账号状态、桌面导航和移动端菜单；页面组件保留现有数据和路由；`globals.css` 负责视觉系统、背景、弹窗和响应式布局。

**Tech Stack:** Next.js App Router, React client components, TypeScript, CSS, existing auth API helpers.

## Global Constraints

- 品牌统一为 `HLOVET`。
- 门户菜单不暴露 `/admin`。
- 登录后继续显示角色徽章和头像菜单。
- 顶部品牌和菜单不放入悬浮框。
- 登录、注册和弹窗使用简洁居中面板和虚化遮罩。
- 移动端菜单默认隐藏，通过左侧图标展开。

---

### Task 1: 文档与范围记录

**Files:**
- Create: `docs/superpowers/specs/2026-07-10-homepage-inspired-refresh-design.zh-CN.md`
- Create: `docs/superpowers/specs/2026-07-10-homepage-inspired-refresh-design.md`
- Create: `docs/superpowers/plans/2026-07-10-homepage-inspired-refresh.zh-CN.md`
- Create: `docs/superpowers/plans/2026-07-10-homepage-inspired-refresh.md`

**Interfaces:**
- Consumes: 用户给出的六条视觉和移动端要求。
- Produces: 本次前端改造的验收标准。

- [ ] 写入中英文设计文档。
- [ ] 写入中英文实施计划。
- [ ] 确认文档没有未完成占位符或与范围冲突的要求。

### Task 2: 顶部导航和移动端菜单

**Files:**
- Modify: `apps/web/src/components/top-nav.tsx`

**Interfaces:**
- Consumes: `getMe`, `logout`, `readAccessToken`, `readRefreshToken`, `clearAuthTokens`。
- Produces: `.menu-toggle`, `.desktop-links`, `.mobile-menu`, `.mobile-menu.open` 等样式钩子。

- [ ] 新增 `isMenuOpen` 状态。
- [ ] 桌面端保留首页、导航、工具、工作台链接。
- [ ] 移动端左侧显示菜单按钮和品牌，右侧显示登录或头像。
- [ ] 菜单链接点击后关闭移动端菜单。
- [ ] 不新增 `/admin` 链接。

### Task 3: 登录和注册页面简化

**Files:**
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/app/register/page.tsx`

**Interfaces:**
- Consumes: existing `login`, `register`, `saveAuthTokens` helpers.
- Produces: `.auth-page`, `.auth-panel`, `.auth-panel-head` simplified structure.

- [ ] 移除侧边说明文案区域。
- [ ] 保留必要表单、错误信息、登录/注册跳转。
- [ ] 登录成功继续跳转 `/dashboard`。
- [ ] 注册成功继续跳转 `/dashboard`。

### Task 4: 全局视觉样式

**Files:**
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Consumes: existing class names used across portal pages.
- Produces: image-backed page, wider content, unframed nav, lighter module hover, modal-style auth and mobile menu.

- [ ] 将 `body` 背景改为图片 + 柔和遮罩。
- [ ] 将 `content-shell` 和 `topbar-inner` 最大宽度扩大到宽屏。
- [ ] 移除顶部导航外框视觉。
- [ ] 降低入口模块 hover 的 transform 和阴影强度。
- [ ] 统一登录、注册、后台密码弹窗的虚化遮罩效果。
- [ ] 添加移动端菜单展开和小屏适配规则。

### Task 5: 验证

**Files:**
- No production files.

**Interfaces:**
- Consumes: local Next.js build and lint scripts.
- Produces: passing verification output and browser screenshots.

- [ ] Run `pnpm --filter @lingxi/web lint`.
- [ ] Run `pnpm --filter @lingxi/web build`.
- [ ] Run `pnpm build`.
- [ ] Use a browser screenshot to check `/`, `/login`, and mobile `/`.
- [ ] Search for old brand text in web source.
- [ ] Search for accidental `/admin` public links.
