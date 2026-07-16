# 登录续期与设备管理设计

## 目标

让用户在正常使用期间保持登录，区分登录过期与权限不足，限制长期累积的登录会话，并让用户能够直接管理自己的登录设备。

## 令牌生命周期

- Access Token 保持短有效期，并通过 `sid` 字段标识当前 Refresh Token 会话。
- 浏览器会在 Access Token 到期前约两分钟自动续期。
- 受保护接口返回 `401` 时，前端自动刷新并重试一次原请求。
- 同一页面使用共享 Promise 合并刷新请求，不同标签页使用短期 localStorage 锁协调刷新。
- 普通接口返回 `403` 时只显示权限错误，不清除登录状态。
- 刷新接口返回 `401` 或 `403` 时清除本地登录信息，因为此时表示刷新会话无效或账号已停用。
- Refresh Token 轮换后保留最初登录时间，同时延长有效期。

## 会话状态

- Refresh Token 记录保存在 `refresh_token:{tokenId}`。
- 账号会话索引保存在 `user_sessions:{userId}`，并使用相同策略设置 TTL。
- 清理时自动从会话索引移除已经不存在的令牌记录。
- 每个账号最多保留 `MAX_REFRESH_SESSIONS_PER_USER` 个有效会话，默认 10 个，最大允许配置为 100 个。
- 超出限制时保留当前会话和其余较新的会话。

## 用户操作

- `POST /auth/sessions`：列出有效会话并标记当前会话。
- `POST /auth/sessions/revoke-others`：撤销当前会话之外的所有 Refresh Token。
- `POST /auth/sessions/revoke-all`：撤销该账号的全部 Refresh Token。
- `/profile` 展示设备与浏览器、IP、登录时间、有效期和当前设备状态。
- 退出全部设备后清除当前浏览器的本地令牌，并返回首页。

## 缓存 TTL 策略

认证缓存 TTL 由系统策略统一管理，不能在 Redis 缓存管理页修改。手动调整可能导致 Refresh Token 记录与用户会话索引不一致；普通业务缓存 TTL 仍然可以修改。

撤销 Refresh Token 会阻止后续续期。已经签发的 Access Token 只会继续有效到自身较短的过期时间。

## 验证

- Access JWT 包含 `sid`。
- Refresh Token 轮换后旧令牌失效，并保留原始登录时间。
- 会话列表能够正确标记当前会话。
- 退出其他设备和退出全部设备时，Redis 令牌记录与索引保持一致。
- 自动清理脏索引成员，并执行默认 10 会话上限。
- API 测试、前后端 lint 和前后端生产构建全部通过。
