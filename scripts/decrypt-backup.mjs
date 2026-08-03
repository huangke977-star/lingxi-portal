import { createDecipheriv } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("Usage: BACKUP_ENCRYPTION_KEY=<key> node scripts/decrypt-backup.mjs <input.enc> <output.sql.gz>");
  process.exit(1);
}

const rawKey = process.env.BACKUP_ENCRYPTION_KEY?.trim();
if (!rawKey) throw new Error("BACKUP_ENCRYPTION_KEY is required.");
const key = /^[a-f\d]{64}$/i.test(rawKey) ? Buffer.from(rawKey, "hex") : Buffer.from(rawKey, "base64");
if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must contain exactly 32 bytes.");

const metadata = await stat(inputPath);
const magicLength = Buffer.byteLength("HLOVETBK1", "ascii");
const headerLength = magicLength + 12;
const tagLength = 16;
if (metadata.size <= headerLength + tagLength) throw new Error("Encrypted backup is incomplete.");

const handle = await open(inputPath, "r");
const header = Buffer.alloc(headerLength);
const tag = Buffer.alloc(tagLength);
try {
  await handle.read(header, 0, header.length, 0);
  await handle.read(tag, 0, tag.length, metadata.size - tagLength);
} finally {
  await handle.close();
}

if (!header.subarray(0, magicLength).equals(Buffer.from("HLOVETBK1", "ascii"))) {
  throw new Error("Encrypted backup header is invalid.");
}

const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(magicLength));
decipher.setAuthTag(tag);
await pipeline(
  createReadStream(inputPath, { start: headerLength, end: metadata.size - tagLength - 1 }),
  decipher,
  createWriteStream(outputPath, { flags: "wx" }),
);
console.log(`Decrypted backup written to ${outputPath}`);
