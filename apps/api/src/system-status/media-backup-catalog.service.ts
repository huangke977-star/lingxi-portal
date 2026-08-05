import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type {
  MediaBackupCatalogFile,
  MediaBackupCatalogSyncResult,
} from "./media-backup-catalog.types";
import type { StorageCategoryKey } from "./storage-management.types";

const MEDIA_BACKUP_CATEGORIES: StorageCategoryKey[] = [
  "backgrounds",
  "site-assets",
  "android-releases",
  "avatars",
  "articles",
  "chat",
];
const CATALOG_TRANSACTION_BATCH_SIZE = 100;

@Injectable()
export class MediaBackupCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async synchronize(
    discoveredFiles: MediaBackupCatalogFile[],
    synchronizedAt = new Date(),
  ): Promise<MediaBackupCatalogSyncResult> {
    const files = this.uniqueFiles(discoveredFiles);
    const existingFiles = await this.prisma.mediaBackupFile.findMany({
      select: {
        category: true,
        storedName: true,
        sizeBytes: true,
        fileUpdatedAt: true,
        contentHash: true,
        lastBackedUpAt: true,
      },
    });
    const existingByKey = new Map(
      existingFiles.map((file) => [
        this.fileKey(file.category, file.storedName),
        file,
      ]),
    );
    const discoveredKeys = new Set(
      files.map((file) => this.fileKey(file.category, file.storedName)),
    );
    let invalidatedHashes = 0;

    for (let offset = 0; offset < files.length; offset += CATALOG_TRANSACTION_BATCH_SIZE) {
      const batch = files.slice(offset, offset + CATALOG_TRANSACTION_BATCH_SIZE);
      await this.prisma.$transaction(
        batch.map((file) => {
          const existing = existingByKey.get(
            this.fileKey(file.category, file.storedName),
          );
          const contentChanged = existing
            ? existing.sizeBytes !== file.sizeBytes ||
              existing.fileUpdatedAt?.getTime() !== file.fileUpdatedAt.getTime()
            : false;
          // A stored hash only describes the exact bytes seen during its previous scan.
          if (
            contentChanged &&
            (existing?.contentHash || existing?.lastBackedUpAt)
          ) {
            invalidatedHashes += 1;
          }
          return this.prisma.mediaBackupFile.upsert({
            where: {
              category_storedName: {
                category: file.category,
                storedName: file.storedName,
              },
            },
            create: {
              category: file.category,
              storedName: file.storedName,
              mimeType: file.mimeType,
              sourceType: file.sourceType,
              sourceId: file.sourceId,
              sourceLabel: file.sourceLabel.slice(0, 255),
              sourceUrl: file.sourceUrl,
              uploadedBy: file.uploadedBy,
              sizeBytes: file.sizeBytes,
              fileUpdatedAt: file.fileUpdatedAt,
              lastSeenAt: synchronizedAt,
            },
            update: {
              mimeType: file.mimeType,
              sourceType: file.sourceType,
              sourceId: file.sourceId,
              sourceLabel: file.sourceLabel.slice(0, 255),
              sourceUrl: file.sourceUrl,
              uploadedBy: file.uploadedBy,
              sizeBytes: file.sizeBytes,
              fileUpdatedAt: file.fileUpdatedAt,
              lastSeenAt: synchronizedAt,
              ...(contentChanged
                ? { contentHash: null, lastBackedUpAt: null }
                : {}),
            },
          });
        }),
      );
    }

    return {
      synchronizedAt,
      totalFiles: files.length,
      staleFiles: existingFiles.filter(
        (file) =>
          !discoveredKeys.has(this.fileKey(file.category, file.storedName)),
      ).length,
      invalidatedHashes,
      categories: MEDIA_BACKUP_CATEGORIES.map((category) => ({
        category,
        fileCount: files.filter((file) => file.category === category).length,
      })),
    };
  }

  private uniqueFiles(files: MediaBackupCatalogFile[]): MediaBackupCatalogFile[] {
    return [
      ...new Map(
        files.map((file) => [
          this.fileKey(file.category, file.storedName),
          file,
        ]),
      ).values(),
    ];
  }

  private fileKey(category: string, storedName: string): string {
    return `${category}\u0000${storedName}`;
  }
}
