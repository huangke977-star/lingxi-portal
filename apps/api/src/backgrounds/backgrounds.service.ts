import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { BackgroundImageResponse, UploadedBackgroundFile } from './backgrounds.types';

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

  async upload(file: UploadedBackgroundFile | undefined, uploadedById: number): Promise<BackgroundImageResponse> {
    if (!file) {
      throw new BadRequestException('A background image file is required.');
    }

    const format = this.validateFile(file);
    const storedName = `${randomUUID()}${format.extension}`;
    const filePath = this.resolveStoredPath(storedName);
    await mkdir(this.uploadDirectory, { recursive: true });
    await writeFile(filePath, file.buffer, { flag: 'wx' });

    try {
      const background = await this.prisma.backgroundImage.create({
        data: {
          originalName: basename(file.originalname).slice(0, 255),
          storedName,
          mimeType: format.mimeType,
          sizeBytes: file.size,
          uploadedById,
        },
        select: this.backgroundSelect(),
      });

      return this.toResponse(background);
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
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

  async getFile(storedName: string): Promise<{ filePath: string; mimeType: string }> {
    const filePath = this.resolveStoredPath(storedName);
    const background = await this.prisma.backgroundImage.findUnique({
      where: { storedName },
      select: { mimeType: true },
    });

    if (!background) {
      throw new NotFoundException('Background image not found.');
    }

    try {
      await access(filePath);
    } catch {
      throw new NotFoundException('Background image file not found.');
    }

    return { filePath, mimeType: background.mimeType };
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
