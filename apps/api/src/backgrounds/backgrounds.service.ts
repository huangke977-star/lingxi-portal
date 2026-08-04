import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { BackgroundImageResponse, UploadedBackgroundFile } from './backgrounds.types';

export const BACKGROUND_MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024;
export const BACKGROUND_MAX_FILES_PER_UPLOAD = 5;
export const BACKGROUND_MAX_OUTPUT_SIZE_BYTES = 1024 * 1024;

const BACKGROUND_OUTPUT_VARIANTS = [
  { width: 2560, height: 1600, quality: 82 },
  { width: 2304, height: 1440, quality: 76 },
  { width: 2048, height: 1280, quality: 70 },
  { width: 1920, height: 1200, quality: 64 },
  { width: 1600, height: 1000, quality: 58 },
  { width: 1440, height: 900, quality: 50 },
  { width: 1280, height: 800, quality: 42 },
] as const;

sharp.cache({ files: 0, items: 20, memory: 32 });
sharp.concurrency(1);

interface BackgroundRecord {
  id: number;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  isActive: boolean;
  uploadedBy: {
    id: number;
    username: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

interface SupportedImageFormat {
  extension: string;
  extensions: string[];
  mimeType: string;
  matches: (buffer: Buffer) => boolean;
}

const SUPPORTED_IMAGE_FORMATS: SupportedImageFormat[] = [
  {
    extension: '.jpg',
    extensions: ['.jpg', '.jpeg'],
    mimeType: 'image/jpeg',
    matches: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  {
    extension: '.png',
    extensions: ['.png'],
    mimeType: 'image/png',
    matches: (buffer) =>
      buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    extension: '.webp',
    extensions: ['.webp'],
    mimeType: 'image/webp',
    matches: (buffer) =>
      buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    extension: '.avif',
    extensions: ['.avif'],
    mimeType: 'image/avif',
    matches: (buffer) =>
      buffer.length >= 12 &&
      buffer.subarray(4, 8).toString('ascii') === 'ftyp' &&
      ['avif', 'avis'].includes(buffer.subarray(8, 12).toString('ascii')),
  },
];

@Injectable()
export class BackgroundsService {
  private readonly uploadDirectory = resolve(
    process.env.BACKGROUND_UPLOAD_DIR ?? join(process.cwd(), 'uploads', 'backgrounds'),
  );

  constructor(private readonly prisma: PrismaService) {}

  async getActive(): Promise<BackgroundImageResponse | null> {
    const background = await this.prisma.backgroundImage.findFirst({
      where: { isActive: true },
      orderBy: { updatedAt: 'desc' },
      select: this.backgroundSelect(),
    });

    return background ? this.toResponse(background) : null;
  }

  async list(): Promise<BackgroundImageResponse[]> {
    const backgrounds = await this.prisma.backgroundImage.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      select: this.backgroundSelect(),
    });

    return backgrounds.map((background) => this.toResponse(background));
  }

  async uploadMany(files: UploadedBackgroundFile[] | undefined, uploadedById: number): Promise<BackgroundImageResponse[]> {
    if (!files?.length) {
      throw new BadRequestException('At least one background image file is required.');
    }

    if (files.length > BACKGROUND_MAX_FILES_PER_UPLOAD) {
      throw new BadRequestException(`At most ${BACKGROUND_MAX_FILES_PER_UPLOAD} images can be uploaded at once.`);
    }

    const preparedFiles: Array<{
      file: UploadedBackgroundFile;
      filePath: string;
      optimizedBuffer: Buffer;
      storedName: string;
    }> = [];

    for (const file of files) {
      this.validateFile(file);
      const optimizedBuffer = await this.optimizeImage(file.buffer);
      const storedName = `${randomUUID()}.webp`;
      preparedFiles.push({
        file,
        filePath: this.resolveStoredPath(storedName),
        optimizedBuffer,
        storedName,
      });
    }

    await mkdir(this.uploadDirectory, { recursive: true });
    const writtenFilePaths: string[] = [];

    try {
      for (const preparedFile of preparedFiles) {
        await writeFile(preparedFile.filePath, preparedFile.optimizedBuffer, { flag: 'wx' });
        writtenFilePaths.push(preparedFile.filePath);
      }

      const backgrounds = await this.prisma.$transaction(async (transaction) => {
        const createdBackgrounds: BackgroundRecord[] = [];

        for (const preparedFile of preparedFiles) {
          const background = await transaction.backgroundImage.create({
            data: {
              originalName: basename(preparedFile.file.originalname).slice(0, 255),
              storedName: preparedFile.storedName,
              mimeType: 'image/webp',
              sizeBytes: preparedFile.optimizedBuffer.length,
              uploadedById,
            },
            select: this.backgroundSelect(),
          });
          createdBackgrounds.push(background);
        }

        return createdBackgrounds;
      });

      return backgrounds.map((background) => this.toResponse(background));
    } catch (error) {
      await Promise.all(writtenFilePaths.map((filePath) => unlink(filePath).catch(() => undefined)));
      throw error;
    }
  }

  async activate(id: number): Promise<BackgroundImageResponse> {
    const existing = await this.prisma.backgroundImage.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Background image not found.');
    }

    const background = await this.prisma.$transaction(async (transaction) => {
      await transaction.backgroundImage.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });

      return transaction.backgroundImage.update({
        where: { id },
        data: { isActive: true },
        select: this.backgroundSelect(),
      });
    });

    return this.toResponse(background);
  }

  async clearActive(): Promise<void> {
    await this.prisma.backgroundImage.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });
  }

  async delete(id: number): Promise<void> {
    const background = await this.prisma.backgroundImage.findUnique({
      where: { id },
      select: { id: true, storedName: true },
    });

    if (!background) {
      throw new NotFoundException('Background image not found.');
    }

    const filePath = this.resolveStoredPath(background.storedName);
    try {
      await unlink(filePath);
    } catch (error) {
      if (!this.isMissingFileError(error)) {
        throw new InternalServerErrorException('Could not delete the background image file.');
      }
    }

    await this.prisma.backgroundImage.delete({ where: { id } });
  }

  async getFile(storedName: string): Promise<{ filePath: string; mimeType: string; sizeBytes: number }> {
    const filePath = this.resolveStoredPath(storedName);
    const background = await this.prisma.backgroundImage.findUnique({
      where: { storedName },
      select: { mimeType: true, sizeBytes: true },
    });

    if (!background) {
      throw new NotFoundException('Background image not found.');
    }

    try {
      await access(filePath);
    } catch {
      throw new NotFoundException('Background image file not found.');
    }

    return { filePath, mimeType: background.mimeType, sizeBytes: background.sizeBytes };
  }

  private validateFile(file: UploadedBackgroundFile): SupportedImageFormat {
    const normalizedMimeType = file.mimetype.toLowerCase();
    const originalExtension = extname(file.originalname).toLowerCase();
    const format = SUPPORTED_IMAGE_FORMATS.find((candidate) => candidate.matches(file.buffer));

    if (!format || normalizedMimeType !== format.mimeType || !format.extensions.includes(originalExtension)) {
      throw new BadRequestException('Only valid JPEG, PNG, WebP, or AVIF images are accepted.');
    }

    return format;
  }

  private async optimizeImage(buffer: Buffer): Promise<Buffer> {
    try {
      for (const variant of BACKGROUND_OUTPUT_VARIANTS) {
        const optimizedBuffer = await sharp(buffer, {
          failOn: 'warning',
          limitInputPixels: 25_000_000,
        })
          .rotate()
          .resize({
            width: variant.width,
            height: variant.height,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({
            effort: 4,
            quality: variant.quality,
            smartSubsample: true,
          })
          .toBuffer();

        if (optimizedBuffer.length <= BACKGROUND_MAX_OUTPUT_SIZE_BYTES) {
          return optimizedBuffer;
        }
      }
    } catch {
      throw new BadRequestException('The background image could not be processed.');
    }

    throw new BadRequestException('The background image could not be compressed below 1 MB.');
  }

  private resolveStoredPath(storedName: string): string {
    if (!/^[0-9a-f-]{36}\.(?:jpg|png|webp|avif)$/i.test(storedName) || basename(storedName) !== storedName) {
      throw new NotFoundException('Background image not found.');
    }

    const filePath = resolve(this.uploadDirectory, storedName);
    if (!filePath.startsWith(`${this.uploadDirectory}${process.platform === 'win32' ? '\\' : '/'}`)) {
      throw new NotFoundException('Background image not found.');
    }

    return filePath;
  }

  private isMissingFileError(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
  }

  private backgroundSelect() {
    return {
      id: true,
      originalName: true,
      storedName: true,
      mimeType: true,
      sizeBytes: true,
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

  private toResponse(background: BackgroundRecord): BackgroundImageResponse {
    return {
      id: background.id,
      originalName: background.originalName,
      mimeType: background.mimeType,
      sizeBytes: background.sizeBytes,
      isActive: background.isActive,
      url: `/backgrounds/files/${background.storedName}`,
      uploadedBy: background.uploadedBy,
      createdAt: background.createdAt,
      updatedAt: background.updatedAt,
    };
  }
}
