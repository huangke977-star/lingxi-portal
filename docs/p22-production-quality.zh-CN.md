# P22 生产质量与稳定性

## 目标

P22 把上线前的人工检查变成可重复执行的发布契约，并给线上问题提供轻量的定位信息。它不引入 Prometheus、Grafana、Sentry 或其他常驻服务，使用现有 API、Redis、系统概览和 Playwright。

## 功能入口

- 超级管理员打开“后台管理 -> 系统运行概览”，执行“P22 生产质量 -> 执行质量检查”。
- 检查结果会记录在“最近演练记录”对应的“质量检查”中，点击“详情”查看具体项、指标和是否因 OSS/R2 待配置而阻塞。
- 系统概览的“接口观察”下方会展示最近前端错误，包括来源、时间、页面路径和构建标识。

## 健康接口

- `GET /health`：只检查 API 进程是否能响应，适合存活探针。
- `GET /health/ready`：执行 MySQL `SELECT 1` 和 Redis `PING`。两项都正常返回 `200`；任一失败返回 `503`，适合反向代理或发布后的就绪检查。
- `POST /health/client-errors`：浏览器异常采集入口，字段会在服务端截断。它不接收认证令牌，也不应主动提交密码、Cookie、请求体或个人内容。

## 本地或线上验收

先准备一个正在运行的 Web 生产构建和 API：

```powershell
$env:LINGXI_E2E_URL = "http://localhost:3000"
python scripts/p22-browser-smoke.py
```

脚本会访问首页、英文首页、文章、专题和合集入口，在桌面 `1440px` 与移动 `390px` 下检查 HTTP 状态、浏览器控制台错误、页面异常、失败图片和横向溢出，并把截图写入 `.artifacts/p22/screenshots`。它只访问公开页面，不登录、不发送文章、评论或聊天内容。

发布契约检查：

```powershell
$env:P22_WEB_BASE_URL = "https://你的域名"
pnpm p22:release-check
```

结果为 JSON。所有 `checks[].ok` 必须为 `true`；重点查看 `api-readiness`、`manifest`、`english-manifest` 和 `service-worker`。

首次建立视觉基线：

```powershell
python scripts/p22-browser-smoke.py --baseline-dir scripts/p22-baselines --update-baseline
```

后续比较：

```powershell
python scripts/p22-browser-smoke.py --baseline-dir scripts/p22-baselines
```

视觉基线只在页面内容稳定后建立。若页面确实发生了预期设计变化，应先人工确认，再重新生成基线；不要为了让脚本通过而直接覆盖基线。

## 结果解释

- `通过`：当前检查已满足条件。
- `预警`：代码能运行，但存在媒体完整性问题等需要处理的业务异常。
- `待配置`：外部服务未提供，例如 OSS/R2；这不是本地代码失败。
- `失败`：数据库、Redis、迁移或媒体巡检无法正常读取，发布前应停止部署并查看详情。

## 资源与隐私边界

- 前端错误只保留最近 100 条，Redis key 有过期时间，不写入 MySQL。
- 错误消息、堆栈和路径均有长度上限；客户端不会上传 Access Token、Refresh Token、Cookie 或表单内容。
- 浏览器脚本不创建业务数据；压测仍使用 P21 的只读白名单接口。
- 清理容器时保留 MySQL、Redis、上传文件、Caddy、TURN 和 sing-box 数据卷。
