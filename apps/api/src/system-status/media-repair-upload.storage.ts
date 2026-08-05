import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";

export const MEDIA_REPAIR_MAX_FILE_SIZE_BYTES = 120 * 1024 * 1024;

export interface UploadedMediaRepairFile {
  originalname: string;
  mimetype: string;
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

export function createMediaRepairUploadStorage() {
  const temporaryDirectory = resolve(
    process.env.MEDIA_REPAIR_TMP_DIR ?? join(tmpdir(), "hlovet-media-repairs"),
  );
  return {
    _handleFile(
      _request: unknown,
      file: IncomingFile,
      callback: StorageCallback,
    ): void {
      void (async () => {
        await mkdir(temporaryDirectory, { recursive: true });
        const filename = `${randomUUID()}.upload`;
        const filePath = join(temporaryDirectory, filename);
        let size = 0;
        file.stream.on("data", (chunk: Buffer | string) => {
          size +=
            typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
        });
        try {
          await pipeline(
            file.stream,
            createWriteStream(filePath, { flags: "wx", mode: 0o600 }),
          );
          callback(null, {
            destination: temporaryDirectory,
            filename,
            path: filePath,
            size,
          });
        } catch (error) {
          await unlink(filePath).catch(() => undefined);
          callback(
            error instanceof Error
              ? error
              : new Error("Media repair upload failed."),
          );
        }
      })();
    },
    _removeFile(
      _request: unknown,
      file: { path?: string },
      callback: (error: Error | null) => void,
    ): void {
      if (!file.path) {
        callback(null);
        return;
      }
      void unlink(file.path)
        .then(() => callback(null))
        .catch((error: NodeJS.ErrnoException) =>
          callback(error.code === "ENOENT" ? null : error),
        );
    },
  };
}
