import { Injectable } from "@nestjs/common";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

@Injectable()
export class TotpService {
  generateSecret(): string {
    return this.toBase32(randomBytes(20));
  }

  buildOtpAuthUri(secret: string, account: string, issuer = "Lingxi Portal"): string {
    return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  }

  verify(secret: string, rawCode: string, now = Date.now()): boolean {
    const code = rawCode.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) return false;
    const counter = Math.floor(now / 1000 / 30);
    for (let offset = -1; offset <= 1; offset += 1) {
      const expected = this.generateCode(secret, counter + offset);
      const expectedBytes = Buffer.from(expected);
      const codeBytes = Buffer.from(code);
      if (expectedBytes.length === codeBytes.length && timingSafeEqual(expectedBytes, codeBytes)) return true;
    }
    return false;
  }

  private generateCode(secret: string, counter: number): string {
    const key = this.fromBase32(secret);
    const input = Buffer.alloc(8);
    input.writeBigUInt64BE(BigInt(Math.max(0, counter)));
    const digest = createHmac("sha1", key).update(input).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);
    return String(binary % 1_000_000).padStart(6, "0");
  }

  private toBase32(value: Buffer): string {
    let bits = 0;
    let buffer = 0;
    let result = "";
    for (const byte of value) {
      buffer = (buffer << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        result += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) result += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
    return result;
  }

  private fromBase32(value: string): Buffer {
    let bits = 0;
    let buffer = 0;
    const bytes: number[] = [];
    for (const char of value.replace(/=+$/, "").toUpperCase()) {
      const index = BASE32_ALPHABET.indexOf(char);
      if (index < 0) throw new Error("Invalid TOTP secret.");
      buffer = (buffer << 5) | index;
      bits += 5;
      if (bits >= 8) {
        bytes.push((buffer >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return Buffer.from(bytes);
  }
}
