# HLOVET 数据库备份运维说明

## 功能范围

- 超级管理员可以在“系统概览”中手动创建、下载、恢复和删除本地备份。
- 可以启用每日自动备份，执行时间使用 `Asia/Shanghai` 时区。
- 本地备份按照配置的保留天数自动清理。
- 阿里云 OSS 与 Cloudflare R2 可以分别启用，也可以同时启用。
- 远端备份上传前使用 AES-256-GCM 客户端加密，远端对象以 `.sql.gz.enc` 结尾。
- 自动备份或异地上传失败时，超级管理员会收到系统通知和浏览器推送。

## 必需的服务器配置

`BACKUP_ENCRYPTION_KEY` 必须是 32 字节密钥，可以使用 64 位十六进制字符串：

```bash
openssl rand -hex 32
```

该密钥同时用于加密异地存储凭证和远端备份文件。密钥丢失后无法解密远端备份，也无法读取已保存的访问凭证，因此必须离线保存一份，不要直接写入项目仓库。

## 阿里云 OSS

1. 创建私有 Bucket，建议使用标准存储。
2. 创建独立 RAM 用户，只授予目标 Bucket 和备份目录的列举、上传、读取、删除权限。
3. 在系统概览中填写 Region、Bucket、目录前缀和 RAM AccessKey。
4. 保存后点击“测试已保存配置”，测试成功后再启用 OSS。

Endpoint 通常可以留空，由 OSS SDK 根据 Region 自动生成。只有使用自定义 Endpoint 时才需要填写 HTTPS 地址。

## Cloudflare R2

1. 创建私有 R2 Bucket。
2. 创建仅能访问该 Bucket 的 R2 API Token。
3. 填写 Cloudflare Account ID、Bucket、目录前缀、Access Key ID 和 Secret Access Key。
4. 保存后测试连接，再启用 R2。

## 保留策略

- 本地保留天数只清理服务器备份目录中的 `.sql` 和 `.sql.gz` 文件。
- 远端保留天数会在每次成功上传后清理对应目录中超过期限的对象。
- 预恢复安全备份只保存在本地，不会因为远端配置错误阻止数据库恢复。

## 恢复远端备份

先从 OSS 或 R2 下载 `.enc` 文件，再使用项目脚本解密：

```bash
BACKUP_ENCRYPTION_KEY=<密钥> node scripts/decrypt-backup.mjs backup.sql.gz.enc backup.sql.gz
```

解密后可以在系统概览中使用本地恢复功能，或者通过 MySQL 客户端手动恢复。生产环境恢复前应先下载并验证当前最新备份。
