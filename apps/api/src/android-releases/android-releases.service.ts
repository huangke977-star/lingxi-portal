import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, open, rename, unlink } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { SiteSettingsService } from '../site-settings/site-settings.service';
import {
  ANDROID_RELEASE_MAX_FILE_SIZE_BYTES,
  UploadedAndroidPackage,
  androidReleaseUploadDirectory,
} from './android-release.storage';
import { AndroidReleaseResponse } from './android-releases.types';
import { UploadAndroidReleaseDto } from './dto/android-release.dto';

interface AndroidReleaseRecord {
  id: number;
  versionName: string;
  versionCode: number;
  channel: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  releaseNotes: string;
  isActive: boolean;
  uploadedBy: {
    id: number;
    username: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

interface PreparedAndroidRelease {
  finalPath: string;
  originalName: string;
  storedName: string;
  sha256: string;
}

@Injectable()
export class AndroidReleasesService {
  private readonly uploadDirectory = androidReleaseUploadDirectory();

  constructor(
    private readonly prisma: PrismaService,
    private readonly siteSettingsService: SiteSettingsService,
  ) {}

  async getLatest(): Promise<AndroidReleaseResponse | null> {
    const activeRelease = await this.prisma.androidRelease.findFirst({
      where: { isActive: true },
      orderBy: { updatedAt: 'desc' },
      select: this.releaseSelect(),
    });

    if (activeRelease) {
      return this.toResponse(activeRelease);
    }

    const latestRelease = await this.prisma.androidRelease.findFirst({
      orderBy: [{ versionCode: 'desc' }, { createdAt: 'desc' }],
      select: this.releaseSelect(),
    });

    return latestRelease ? this.toResponse(latestRelease) : null;
  }

  async list(): Promise<AndroidReleaseResponse[]> {
    const releases = await this.prisma.androidRelease.findMany({
      orderBy: [{ isActive: 'desc' }, { versionCode: 'desc' }, { createdAt: 'desc' }],
      select: this.releaseSelect(),
    });

    return releases.map((release) => this.toResponse(release));
  }

  async upload(
    file: UploadedAndroidPackage | undefined,
    dto: UploadAndroidReleaseDto,
    uploadedById: number,
  ): Promise<AndroidReleaseResponse> {
    if (!file) {
      throw new BadRequestException('Please select an Android APK file.');
    }

    let finalPath = '';

    try {
      const prepared = await this.prepareFile(file);
      finalPath = prepared.finalPath;
      await mkdir(this.uploadDirectory, { recursive: true });
      await rename(file.path, finalPath);

      const hasActiveRelease = Boolean(
        await this.prisma.androidRelease.findFirst({
          where: { isActive: true },
          select: { id: true },
        }),
      );
      const shouldActivate = dto.activate !== 'false' || !hasActiveRelease;

      const release = await this.prisma.$transaction(async (transaction) => {
        if (shouldActivate) {
          await transaction.androidRelease.updateMany({
            where: { isActive: true },
            data: { isActive: false },
          });
        }

        return transaction.androidRelease.create({
          data: {
            versionName: dto.versionName.trim(),
            versionCode: dto.versionCode,
            channel: normalizeChannel(dto.channel),
            originalName: prepared.originalName,
            storedName: prepared.storedName,
            mimeType: 'application/vnd.android.package-archive',
            sizeBytes: file.size,
            sha256: prepared.sha256,
            releaseNotes: normalizeReleaseNotes(dto.releaseNotes).join('\n'),
            isActive: shouldActivate,
            uploadedById,
          },
          select: this.releaseSelect(),
        });
      });

      const policy = await this.siteSettingsService.getAndroidReleasePolicy();
      if (!policy.apkHistoryEnabled || policy.apkAutoCleanupEnabled) {
        await this.cleanupInactiveReleases(
          policy.apkHistoryEnabled ? policy.apkRetentionCount : 0,
          release.id,
        );
      }

      return this.toResponse(release);
    } catch (error) {
      await Promise.all([
        unlink(file.path).catch(() => undefined),
        finalPath ? unlink(finalPath).catch(() => undefined) : Promise.resolve(),
      ]);
      throw error;
    }
  }

  async activate(id: number): Promise<AndroidReleaseResponse> {
    const existing = await this.prisma.androidRelease.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Android release not found.');
    }

    const release = await this.prisma.$transaction(async (transaction) => {
      await transaction.androidRelease.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });

      return transaction.androidRelease.update({
        where: { id },
        data: { isActive: true },
        select: this.releaseSelect(),
      });
    });

    return this.toResponse(release);
  }

  async delete(id: number): Promise<void> {
    const release = await this.prisma.androidRelease.findUnique({
      where: { id },
      select: { id: true, storedName: true },
    });

    if (!release) {
      throw new NotFoundException('Android release not found.');
    }

    const filePath = this.resolveStoredPath(release.storedName);
    try {
      await unlink(filePath);
    } catch (error) {
      if (!this.isMissingFileError(error)) {
        throw new InternalServerErrorException('Could not delete the Android APK file.');
      }
    }

    await this.prisma.androidRelease.delete({ where: { id } });
  }

  async getFile(storedName: string): Promise<{
    filePath: string;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
  }> {
    const filePath = this.resolveStoredPath(storedName);
    const release = await this.prisma.androidRelease.findUnique({
      where: { storedName },
      select: { mimeType: true, originalName: true, sizeBytes: true },
    });

    if (!release) {
      throw new NotFoundException('Android release not found.');
    }

    try {
      await access(filePath);
    } catch {
      throw new NotFoundException('Android APK file not found.');
    }

    return { filePath, ...release };
  }

  private async prepareFile(file: UploadedAndroidPackage): Promise<PreparedAndroidRelease> {
    if (file.size > ANDROID_RELEASE_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('Android APK files cannot exceed 120 MB.');
    }

    const originalName = sanitizeOriginalName(file.originalname);
    if (extname(originalName).toLowerCase() !== '.apk') {
      throw new BadRequestException('Only .apk files are accepted.');
    }

    if (!(await hasZipSignature(file.path))) {
      throw new BadRequestException('The selected file is not a valid APK package.');
    }

    const storedName = `${randomUUID()}.apk`;
    return {
      finalPath: this.resolveStoredPath(storedName),
      originalName,
      storedName,
      sha256: await sha256File(file.path),
    };
  }

  private resolveStoredPath(storedName: string): string {
    if (!/^[0-9a-f-]{36}\.apk$/i.test(storedName) || basename(storedName) !== storedName) {
      throw new NotFoundException('Android release not found.');
    }

    const filePath = resolve(this.uploadDirectory, storedName);
    const boundary = `${this.uploadDirectory}${process.platform === 'win32' ? '\\' : '/'}`;
    if (!filePath.startsWith(boundary)) {
      throw new NotFoundException('Android release not found.');
    }

    return filePath;
  }

  private isMissingFileError(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
  }

  private releaseSelect() {
    return {
      id: true,
      versionName: true,
      versionCode: true,
      channel: true,
      originalName: true,
      storedName: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      releaseNotes: true,
      isActive: true,
      uploadedBy: {
        select: {
          id: true,
          username: true,
        },
      },
      createdAt: true,
      updatedAt: true,
    };
  }

  private async cleanupInactiveReleases(retentionCount: number, protectedReleaseId: number): Promise<void> {
    const inactiveReleases = await this.prisma.androidRelease.findMany({
      where: { isActive: false, id: { not: protectedReleaseId } },
      orderBy: [{ versionCode: 'desc' }, { createdAt: 'desc' }],
      skip: Math.max(0, retentionCount),
      select: { id: true, storedName: true },
    });

    for (const release of inactiveReleases) {
      const filePath = this.resolveStoredPath(release.storedName);
      await unlink(filePath).catch(() => undefined);
      await this.prisma.androidRelease.delete({ where: { id: release.id } }).catch(() => undefined);
    }
  }

  private toResponse(release: AndroidReleaseRecord): AndroidReleaseResponse {
    return {
      id: release.id,
      versionName: release.versionName,
      versionCode: release.versionCode,
      channel: release.channel,
      originalName: release.originalName,
      fileName: release.originalName,
      mimeType: release.mimeType,
      sizeBytes: release.sizeBytes,
      sha256: release.sha256,
      apkUrl: `/android-releases/files/${release.storedName}`,
      releaseNotes: normalizeReleaseNotes(release.releaseNotes),
      isActive: release.isActive,
      uploadedBy: release.uploadedBy,
      createdAt: release.createdAt.toISOString(),
      updatedAt: release.updatedAt.toISOString(),
    };
  }
}

async function hasZipSignature(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r');
  try {
    const signature = Buffer.alloc(4);
    const { bytesRead } = await handle.read(signature, 0, 4, 0);
    return bytesRead === 4 && ['504b0304', '504b0506', '504b0708'].includes(signature.toString('hex'));
  } finally {
    await handle.close();
  }
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex').toUpperCase()));
  });
}

function sanitizeOriginalName(originalName: string): string {
  return basename((originalName || 'hlovet.apk').replace(/\\/g, '/')).slice(0, 255) || 'hlovet.apk';
}

function normalizeChannel(channel: string | undefined): string {
  const normalizedChannel = channel?.trim() || 'stable';
  return normalizedChannel.slice(0, 40);
}

function normalizeReleaseNotes(notes: string | undefined): string[] {
  return (notes ?? '')
    .split(/\r?\n/)
    .map((note) => note.trim())
    .filter(Boolean)
    .slice(0, 20);
}
