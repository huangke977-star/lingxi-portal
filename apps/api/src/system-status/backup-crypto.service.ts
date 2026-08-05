import { BadRequestException, Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, open, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";

const FILE_MAGIC = Buffer.from("HLOVETBK1", "ascii");
const FILE_IV_BYTES = 12;
const FILE_AUTH_TAG_BYTES = 16;
const FILE_HEADER_BYTES = FILE_MAGIC.length + FILE_IV_BYTES;

@Injectable()
export class BackupCryptoService {
  private readonly key = this.readEncryptionKey();

  isConfigured(): boolean {
    return Boolean(this.key);
  }

  encryptSecret(value: string): string {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
  }

  decryptSecret(value: string): string {
    const key = this.requireKey();
    const [version, ivValue, tagValue, encryptedValue] = value.split(".");
    if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) {
      throw new BadRequestException("异地备份凭证格式无效，请重新填写并保存。");
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64"));
      decipher.setAuthTag(Buffer.from(tagValue, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new BadRequestException("异地备份凭证无法解密，请重新填写并保存。");
    }
  }

  async encryptFile(sourcePath: string): Promise<{ filePath: string; sizeBytes: number; cleanup: () => Promise<void> }> {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const destination = join(tmpdir(), `${basename(sourcePath)}.${randomBytes(6).toString("hex")}.enc`);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    await writeFile(destination, Buffer.concat([FILE_MAGIC, iv]), { flag: "wx" });
    try {
      await pipeline(
        createReadStream(sourcePath),
        cipher,
        createWriteStream(destination, { flags: "a" }),
      );
      await appendFile(destination, cipher.getAuthTag());
      const encrypted = await stat(destination);
      return {
        filePath: destination,
        sizeBytes: encrypted.size,
        cleanup: () => unlink(destination).catch(() => undefined),
      };
    } catch (error) {
      await unlink(destination).catch(() => undefined);
      throw error;
    }
  }

  async decryptFile(sourcePath: string, destinationPath: string): Promise<{ sizeBytes: number }> {
    const key = this.requireKey();
    const source = await stat(sourcePath);
    if (source.size <= FILE_HEADER_BYTES + FILE_AUTH_TAG_BYTES) {
      throw new BadRequestException("远端备份文件格式无效。");
    }
    const handle = await open(sourcePath, "r");
    const header = Buffer.alloc(FILE_HEADER_BYTES);
    const authTag = Buffer.alloc(FILE_AUTH_TAG_BYTES);
    try {
      await handle.read(header, 0, header.length, 0);
      await handle.read(
        authTag,
        0,
        authTag.length,
        source.size - FILE_AUTH_TAG_BYTES,
      );
    } finally {
      await handle.close();
    }
    if (!header.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) {
      throw new BadRequestException("远端备份文件格式无效。");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      header.subarray(FILE_MAGIC.length),
    );
    decipher.setAuthTag(authTag);
    try {
      await pipeline(
        createReadStream(sourcePath, {
          start: FILE_HEADER_BYTES,
          end: source.size - FILE_AUTH_TAG_BYTES - 1,
        }),
        decipher,
        createWriteStream(destinationPath, { flags: "wx", mode: 0o600 }),
      );
      return { sizeBytes: (await stat(destinationPath)).size };
    } catch (error) {
      await unlink(destinationPath).catch(() => undefined);
      throw new BadRequestException(
        error instanceof Error && error.message
          ? `远端备份解密失败：${error.message}`
          : "远端备份解密失败。",
      );
    }
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new BadRequestException("服务器尚未配置 BACKUP_ENCRYPTION_KEY，无法启用异地备份。");
    }
    return this.key;
  }

  private readEncryptionKey(): Buffer | null {
    const raw = process.env.BACKUP_ENCRYPTION_KEY?.trim();
    if (!raw) return null;
    const key = /^[a-f\d]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (key.length !== 32) {
      throw new Error("BACKUP_ENCRYPTION_KEY must contain exactly 32 bytes encoded as hex or base64.");
    }
    return key;
  }
}
