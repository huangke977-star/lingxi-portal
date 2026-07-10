# HLOVET 深色城市灯火刷新实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 HLOVET 改为深色城市灯火背景、居中高亮菜单、圆润字体和更克制的功能模块。

**Architecture:** 只修改 Web 前端。`TopNav` 负责路由高亮、移动端菜单开关和点击外部关闭；全局 CSS 负责深色主题、字体、背景图和响应式布局；背景图作为本地静态资源由 Next.js 直接提供。

**Tech Stack:** Next.js App Router, React client components, TypeScript, CSS, local static assets.

## Global Constraints

- 品牌继续使用 `HLOVET`。
- 字体使用方案 A：`MiSans`、`HarmonyOS Sans SC`、`PingFang SC`、`Microsoft YaHei UI` 等系统字体栈。
- 背景使用本地城市灯火资源，不依赖外链背景。
- 顶部菜单使用文字和细线高亮，不使用按钮底色。
- 门户菜单不暴露 `/admin`。
- 移动端菜单按钮位于品牌下方一行，点击外部关闭。

---

### Task 1: 文档和本地背景资产

**Files:**
- Create: `docs/superpowers/specs/2026-07-10-deep-city-lights-refresh-design.zh-CN.md`
- Create: `docs/superpowers/specs/2026-07-10-deep-city-lights-refresh-design.md`
- Create: `docs/superpowers/plans/2026-07-10-deep-city-lights-refresh.zh-CN.md`
- Create: `docs/superpowers/plans/2026-07-10-deep-city-lights-refresh.md`
- Create: `apps/web/public/images/hlovet-city-lights.jpg`

**Interfaces:**
- Consumes: 用户确认的字体方案 A 和城市灯火背景方向。
- Produces: 本轮可验证的视觉验收标准和本地背景资源。

- [ ] 写入中英文设计文档。
- [ ] 写入中英文实施计划。
- [ ] 生成本地城市灯火 JPG 背景图。

### Task 2: 顶部导航行为

**Files:**
- Modify: `apps/web/src/components/top-nav.tsx`

**Interfaces:**
- Consumes: `usePathname`, existing auth helpers, existing `navItems`。
- Produces: active link class names, mobile outside-click close behavior。

- [ ] 引入 `usePathname`。
- [ ] 根据当前路由设置菜单项 active 状态。
- [ ] 移动端菜单项点击后关闭。
- [ ] 菜单打开后点击导航区域外关闭。

### Task 3: 深色玻璃视觉系统

**Files:**
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Consumes: existing page class names。
- Produces: deep glass theme, local background, rounded font stack, centered active nav, text actions, mobile second-line menu。

- [ ] 将字体栈替换为方案 A。
- [ ] 将背景图改为 `/images/hlovet-city-lights.jpg`。
- [ ] 深化颜色变量和磨砂面板。
- [ ] 将菜单改为居中文字和 active underline。
- [ ] 将首页动作和登录入口视觉降为文字型。
- [ ] 调整卡片默认状态和 hover 状态。
- [ ] 重排移动端顶部导航和菜单。

### Task 4: 验证、提交和部署

**Files:**
- No production files.

**Interfaces:**
- Consumes: local lint/build, browser screenshots, GitHub Actions, production deployment。
- Produces: verified local and online HLOVET UI。

- [ ] Run `pnpm --filter @lingxi/web lint`。
- [ ] Run `pnpm --filter @lingxi/web build`。
- [ ] Run `pnpm build`。
- [ ] 用浏览器截图检查桌面、登录页、移动端首页和移动菜单。
- [ ] 提交并推送。
- [ ] 等待 Docker Images 流水线成功。
- [ ] 服务器拉取镜像并重启。
- [ ] 检查线上页面和 API health。
