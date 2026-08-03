import { BadRequestException, Injectable } from "@nestjs/common";
import type { S3Client } from "@aws-sdk/client-s3";
import type OSS from "ali-oss";
import { createReadStream } from "node:fs";
import type { BackupConfiguration } from "../generated/prisma/client";
import { BackupCryptoService } from "./backup-crypto.service";
import type { RemoteBackupResult, RemoteProvider } from "./system-status.types";

interface AliOssListResult {
  objects?: Array<{ name: string; lastModified?: string }>;
  isTruncated?: boolean;
  nextMarker?: string;
}

@Injectable()
export class BackupRemoteService {
  constructor(private readonly crypto: BackupCryptoService) {}

  async upload(
    sourcePath: string,
    backupName: string,
    configuration: BackupConfiguration,
  ): Promise<RemoteBackupResult[]> {
    const providers = this.enabledProviders(configuration);
    if (!providers.length) return [];
    const encrypted = await this.crypto.encryptFile(sourcePath);
    const objectName = `${backupName}.enc`;
    const results: RemoteBackupResult[] = [];
    try {
      for (const provider of providers) {
        try {
          const objectKey = provider === "oss"
            ? await this.uploadOss(configuration, encrypted.filePath, objectName)
            : await this.uploadR2(configuration, encrypted.filePath, objectName);
          await this.cleanup(provider, configuration);
          results.push({ provider, status: "success", objectKey, error: null });
        } catch (error) {
          results.push({
            provider,
            status: "failed",
            objectKey: null,
            error: this.errorMessage(error),
          });
        }
      }
      return results;
    } finally {
      await encrypted.cleanup();
    }
  }

  async test(provider: RemoteProvider, configuration: BackupConfiguration): Promise<{ success: true; provider: RemoteProvider }> {
    if (provider === "oss") {
      const client = await this.ossClient(configuration);
      await client.list({ prefix: this.prefix(configuration.ossPrefix), "max-keys": 1 }, {});
    } else {
      const { ListObjectsV2Command } = await this.awsSdk();
      const client = await this.r2Client(configuration);
      try {
        await client.send(new ListObjectsV2Command({
          Bucket: this.required(configuration.r2Bucket, "R2 Bucket"),
          Prefix: this.prefix(configuration.r2Prefix),
          MaxKeys: 1,
        }));
      } finally {
        client.destroy();
      }
    }
    return { success: true, provider };
  }

  private async uploadOss(
    configuration: BackupConfiguration,
    filePath: string,
    objectName: string,
  ): Promise<string> {
    const client = await this.ossClient(configuration);
    const objectKey = this.objectKey(configuration.ossPrefix, objectName);
    await client.put(objectKey, filePath, {
      headers: { "x-oss-object-acl": "private", "content-type": "application/octet-stream" },
    });
    return objectKey;
  }

  private async uploadR2(
    configuration: BackupConfiguration,
    filePath: string,
    objectName: string,
  ): Promise<string> {
    const { PutObjectCommand } = await this.awsSdk();
    const client = await this.r2Client(configuration);
    const objectKey = this.objectKey(configuration.r2Prefix, objectName);
    try {
      await client.send(new PutObjectCommand({
        Bucket: this.required(configuration.r2Bucket, "R2 Bucket"),
        Key: objectKey,
        Body: createReadStream(filePath),
        ContentType: "application/octet-stream",
      }));
      return objectKey;
    } finally {
      client.destroy();
    }
  }

  private async cleanup(provider: RemoteProvider, configuration: BackupConfiguration): Promise<void> {
    const cutoff = new Date(Date.now() - configuration.remoteRetentionDays * 86_400_000);
    if (provider === "oss") {
      const client = await this.ossClient(configuration);
      let marker: string | undefined;
      do {
        const result = await client.list({
          prefix: this.prefix(configuration.ossPrefix),
          marker,
          "max-keys": 1000,
        }, {}) as AliOssListResult;
        const expired = (result.objects ?? [])
          .filter((item) => item.name.endsWith(".sql.gz.enc") && item.lastModified && new Date(item.lastModified) < cutoff)
          .map((item) => item.name);
        if (expired.length) await client.deleteMulti(expired, { quiet: true });
        marker = result.isTruncated ? result.nextMarker : undefined;
      } while (marker);
      return;
    }

    const { DeleteObjectsCommand, ListObjectsV2Command } = await this.awsSdk();
    const client = await this.r2Client(configuration);
    try {
      let continuationToken: string | undefined;
      do {
        const result = await client.send(new ListObjectsV2Command({
          Bucket: this.required(configuration.r2Bucket, "R2 Bucket"),
          Prefix: this.prefix(configuration.r2Prefix),
          ContinuationToken: continuationToken,
        }));
        const expired = (result.Contents ?? [])
          .filter((item) => item.Key?.endsWith(".sql.gz.enc") && item.LastModified && item.LastModified < cutoff)
          .map((item) => ({ Key: item.Key! }));
        if (expired.length) {
          await client.send(new DeleteObjectsCommand({
            Bucket: this.required(configuration.r2Bucket, "R2 Bucket"),
            Delete: { Objects: expired, Quiet: true },
          }));
        }
        continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
      } while (continuationToken);
    } finally {
      client.destroy();
    }
  }

  private async ossClient(configuration: BackupConfiguration): Promise<OSS> {
    const module = await import("ali-oss");
    const OssClient = module.default;
    return new OssClient({
      region: this.required(configuration.ossRegion, "OSS Region"),
      endpoint: configuration.ossEndpoint?.trim() || undefined,
      accessKeyId: this.decryptRequired(configuration.ossAccessKeyIdEncrypted, "OSS AccessKey ID"),
      accessKeySecret: this.decryptRequired(configuration.ossAccessKeySecretEncrypted, "OSS AccessKey Secret"),
      bucket: this.required(configuration.ossBucket, "OSS Bucket"),
      secure: true,
      timeout: 60_000,
    });
  }

  private async r2Client(configuration: BackupConfiguration): Promise<S3Client> {
    const { S3Client } = await this.awsSdk();
    const accountId = this.required(configuration.r2AccountId, "R2 Account ID");
    return new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.decryptRequired(configuration.r2AccessKeyIdEncrypted, "R2 Access Key ID"),
        secretAccessKey: this.decryptRequired(configuration.r2SecretAccessKeyEncrypted, "R2 Secret Access Key"),
      },
    });
  }

  private awsSdk() {
    return import("@aws-sdk/client-s3");
  }

  private enabledProviders(configuration: BackupConfiguration): RemoteProvider[] {
    const providers: RemoteProvider[] = [];
    if (configuration.ossEnabled) providers.push("oss");
    if (configuration.r2Enabled) providers.push("r2");
    return providers;
  }

  private decryptRequired(value: string | null, label: string): string {
    if (!value) throw new BadRequestException(`${label} 尚未配置。`);
    return this.crypto.decryptSecret(value);
  }

  private required(value: string | null, label: string): string {
    const normalized = value?.trim();
    if (!normalized) throw new BadRequestException(`${label} 尚未配置。`);
    return normalized;
  }

  private objectKey(prefix: string, objectName: string): string {
    const datePath = new Date().toISOString().slice(0, 10).replaceAll("-", "/");
    return `${this.prefix(prefix)}${datePath}/${objectName}`;
  }

  private prefix(value: string): string {
    const normalized = value.trim().replace(/^\/+|\/+$/g, "");
    return normalized ? `${normalized}/` : "";
  }

  private errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : "异地备份上传失败。";
    return message.replace(/[\r\n]+/g, " ").slice(0, 400);
  }
}
