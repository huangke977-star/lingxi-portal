# 语音消息与音视频通话设计

## 功能范围

- 好友私聊支持最长 5 分钟、单条不超过 20MB 的语音消息。
- 聊天附件支持音频和视频的内嵌播放；单个视频不超过 50MB，单条消息全部附件总计不超过 50MB。
- 已接受的好友之间支持一对一语音通话和视频通话。
- 第一版不支持群组通话、屏幕共享、服务器录音录像或通话内容回放。
- 通话浮层挂载在根布局中，切换页面不会中断；桌面端和移动端都可以最小化后继续通话。

## 媒体与信令

- 浏览器使用 WebRTC 直接传输音视频，NestJS 不转发媒体流。
- 现有 Socket.IO `/chat` 命名空间只传输呼叫状态、SDP 和 ICE candidate。
- 服务器验证发起人和接听人属于同一个已接受好友会话，并限制每个账号同一时间只能进行一通电话。
- 呼叫状态包括响铃、已接听、连接中、通话中、拒绝、忙线、取消、未接、完成和失败。
- 结束状态会写入 MySQL，并在对应聊天会话中生成一条简洁的通话记录。

## TURN 安全

- `turn.5200918.xyz` 必须使用仅 DNS 模式，不能启用 Cloudflare 代理。
- coturn 使用 REST shared-secret 认证。共享密钥只保存在 API 和 coturn 的服务器环境变量中。
- 浏览器通过登录保护的 `/api/social/calls/ice-servers` 获取短期用户名和 HMAC-SHA1 密码，默认一小时后失效。
- 网站 HTTPS 和 WebSocket 继续使用 `443`；coturn 只使用 `3478/TCP`、`3478/UDP` 和 `49160-49200/UDP`。
- 第一版关闭 `5349`、TURN over TLS、DTLS 和 TCP peer relay，后续确有网络兼容需求时再单独启用。

## 生产配置

Cloudflare DNS：

- 记录类型：`A`
- 名称：`turn`
- 内容：VPS 公网 IP
- 代理状态：仅 DNS

阿里云防火墙：

- `3478/TCP`
- `3478/UDP`
- `49160-49200/UDP`

生产 `.env`：

```dotenv
TURN_HOST=turn.5200918.xyz
TURN_REALM=turn.5200918.xyz
TURN_SECRET=<服务器生成的高强度随机值>
TURN_EXTERNAL_IP=<VPS 公网 IP>
TURN_INTERNAL_IP=<VPS 私网 IP>
TURN_PORT=3478
TURN_UDP_MIN=49160
TURN_UDP_MAX=49200
TURN_CREDENTIAL_TTL_SECONDS=3600
STUN_URLS=stun:turn.5200918.xyz:3478
```

如果 VPS 公网 IP 通过 NAT 映射，`TURN_EXTERNAL_IP` 使用 `公网IP/私网IP` 格式，并将 `TURN_INTERNAL_IP` 设置为同一个私网 IP。显式监听该私网地址可以避免 coturn 误用 Docker 网桥地址。不要把 TURN 密钥写入 Git、文档、日志或聊天记录。

## 浏览器兼容

- Chrome、Edge 和 Android 优先录制 Opus WebM。
- Safari 和 iPhone 在不支持 WebM MediaRecorder 时使用 MP4/M4A 音频。
- 摄像头切换使用 `facingMode`，桌面设备没有第二个摄像头时保留当前摄像头并显示提示。
- 浏览器必须通过 HTTPS 访问，才能使用麦克风、摄像头和 WebRTC。

## 资源边界

- coturn 容器限制为 96MB 内存、0.2 CPU、每个临时用户最多 8 个 allocation、全局最多 80 个 allocation。
- WebRTC 直连成功时，VPS 不承载音视频带宽；只有直连失败并回退到 TURN 时才消耗服务器双向流量。
- 当前 2 vCPU、2GiB VPS 适合少量一对一通话，不适合高并发视频会议。
