import { BadRequestException, Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

@Injectable()
export class SecretCryptoService {
  private readonly key = this.readKey();

  isConfigured(): boolean {
    return Boolean(this.key);
  }

  encrypt(value: string): string {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
  }

  decrypt(value: string): string {
    const key = this.requireKey();
    const [version, iv, tag, payload] = value.split(".");
    if (version !== "v1" || !iv || !tag || !payload) {
      throw new BadRequestException("安全凭据格式无效，请重新填写并保存。");
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(payload, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new BadRequestException("安全凭据无法解密，请重新填写并保存。");
    }
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new BadRequestException("服务器尚未配置 BACKUP_ENCRYPTION_KEY，无法保存安全凭据。");
    }
    return this.key;
  }

  private readKey(): Buffer | null {
    const raw = process.env.BACKUP_ENCRYPTION_KEY?.trim();
    if (!raw) return null;
    const key = /^[a-f\d]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (key.length !== 32) {
      throw new Error("BACKUP_ENCRYPTION_KEY must contain exactly 32 bytes encoded as hex or base64.");
    }
    return key;
  }
}
