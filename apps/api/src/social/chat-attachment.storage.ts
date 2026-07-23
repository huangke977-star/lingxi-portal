import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

export const CHAT_ATTACHMENT_MAX_FILES = 9;
export const CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_BATCH_SIZE_BYTES = 50 * 1024 * 1024;
export const CHAT_IMAGE_MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;

export interface UploadedChatAttachment {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  destination: string;
  filename: string;
  path: string;
  size: number;
}

interface IncomingFile {
  stream: NodeJS.ReadableStream;
}

interface StoredFileInfo {
  destination: string;
  filename: string;
  path: string;
  size: number;
}

type StorageCallback = (error: Error | null, info?: StoredFileInfo) => void;

export function chatUploadDirectory(): string {
  return resolve(process.env.CHAT_UPLOAD_DIR ?? join(process.cwd(), "uploads", "chat"));
}

export function createChatAttachmentStorage() {
  const temporaryDirectory = join(chatUploadDirectory(), ".tmp");

  return {
    _handleFile(_request: unknown, file: IncomingFile, callback: StorageCallback): void {
      void (async () => {
        await mkdir(temporaryDirectory, { recursive: true });
        const filename = `${randomUUID()}.upload`;
        const filePath = join(temporaryDirectory, filename);
        let size = 0;
        file.stream.on("data", (chunk: Buffer | string) => {
          size += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
        });
        try {
          await pipeline(file.stream, createWriteStream(filePath, { flags: "wx" }));
          callback(null, { destination: temporaryDirectory, filename, path: filePath, size });
        } catch (error) {
          await unlink(filePath).catch(() => undefined);
          callback(error instanceof Error ? error : new Error("Attachment upload failed."));
        }
      })();
    },
    _removeFile(_request: unknown, file: { path?: string }, callback: (error: Error | null) => void): void {
      if (!file.path) {
        callback(null);
        return;
      }
      void unlink(file.path)
        .then(() => callback(null))
        .catch((error: NodeJS.ErrnoException) => callback(error.code === "ENOENT" ? null : error));
    },
  };
}
