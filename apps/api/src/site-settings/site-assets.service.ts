import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { Prisma, SiteAssetKind } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SiteAssetResponse } from "./site-settings.types";

export const SITE_ASSET_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export interface UploadedSiteAssetFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface SiteAssetRecord {
  id: number;
  kind: SiteAssetKind;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: {
    id: number;
    username: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

interface SupportedSiteAssetFormat {
  extension: string;
  extensions: string[];
  mimeType: string;
  allowedKinds: SiteAssetKind[];
  matches: (buffer: Buffer) => boolean;
}

const SUPPORTED_SITE_ASSET_FORMATS: SupportedSiteAssetFormat[] = [
  {
    extension: ".svg",
    extensions: [".svg"],
    mimeType: "image/svg+xml",
    allowedKinds: [SiteAssetKind.logo],
    matches: (buffer) => {
      const text = buffer.subarray(0, Math.min(buffer.length, 512)).toString("utf8").trimStart();
      return text.startsWith("<svg") || text.startsWith("<?xml");
    },
  },
  {
    extension: ".png",
    extensions: [".png"],
    mimeType: "image/png",
    allowedKinds: [SiteAssetKind.logo, SiteAssetKind.pwa_icon],
    matches: (buffer) =>
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    extension: ".jpg",
    extensions: [".jpg", ".jpeg"],
    mimeType: "image/jpeg",
    allowedKinds: [SiteAssetKind.logo, SiteAssetKind.pwa_icon],
    matches: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  {
    extension: ".webp",
    extensions: [".webp"],
    mimeType: "image/webp",
    allowedKinds: [SiteAssetKind.logo, SiteAssetKind.pwa_icon],
    matches: (buffer) =>
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

@Injectable()
export class SiteAssetsService {
  private readonly uploadDirectory = resolve(
    process.env.SITE_ASSET_UPLOAD_DIR ?? join(process.cwd(), "uploads", "site-assets"),
  );

  constructor(private readonly prisma: PrismaService) {}

  async list(kind?: string): Promise<SiteAssetResponse[]> {
    const normalizedKind = kind ? this.normalizeKind(kind) : undefined;
    const assets = await this.prisma.siteAsset.findMany({
      where: normalizedKind ? { kind: normalizedKind } : undefined,
      orderBy: [{ kind: "asc" }, { createdAt: "desc" }, { id: "desc" }],
      select: this.assetSelect(),
    });
    return assets.map((asset) => this.toResponse(asset));
  }

  async upload(
    rawKind: string | undefined,
    file: UploadedSiteAssetFile | undefined,
    uploadedById: number,
  ): Promise<SiteAssetResponse> {
    if (!file) {
      throw new BadRequestException("请选择要上传的站点资源。");
    }
    const kind = this.normalizeKind(rawKind);
    const format = this.validateFile(kind, file);
    const storedName = `${kind}-${randomUUID()}${format.extension}`;
    const filePath = this.resolveStoredPath(storedName);

    await mkdir(this.uploadDirectory, { recursive: true });
    try {
      await writeFile(filePath, file.buffer, { flag: "wx" });
      const asset = await this.prisma.siteAsset.create({
        data: {
          kind,
          originalName: basename(file.originalname).slice(0, 255),
          storedName,
          mimeType: format.mimeType,
          sizeBytes: file.size,
          uploadedById,
        },
        select: this.assetSelect(),
      });
      return this.toResponse(asset);
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  }

  async delete(id: number): Promise<void> {
    const asset = await this.prisma.siteAsset.findUnique({
      where: { id },
      select: { kind: true, storedName: true },
    });
    if (!asset) {
      throw new NotFoundException("站点资源不存在。");
    }
    const settings = await this.prisma.siteSetting.findUnique({
      where: { id: 1 },
      select: { logoPath: true, pwaIconPath: true },
    });
    const configuredPath = asset.kind === SiteAssetKind.logo
      ? settings?.logoPath
      : settings?.pwaIconPath;
    const publicPath = `/site-settings/assets/files/${asset.storedName}`;
    if (configuredPath === publicPath || configuredPath === `/api${publicPath}`) {
      throw new BadRequestException("该资源正在使用，请先选择并保存其他资源后再删除。");
    }
    const filePath = this.resolveStoredPath(asset.storedName);
    try {
      await unlink(filePath);
    } catch (error) {
      if (!this.isMissingFileError(error)) {
        throw new InternalServerErrorException("站点资源文件删除失败。");
      }
    }
    await this.prisma.siteAsset.delete({ where: { id } });
  }

  async getFile(storedName: string): Promise<{ filePath: string; mimeType: string }> {
    const filePath = this.resolveStoredPath(storedName);
    const asset = await this.prisma.siteAsset.findUnique({
      where: { storedName },
      select: { mimeType: true },
    });
    if (!asset) {
      throw new NotFoundException("站点资源不存在。");
    }
    try {
      await access(filePath);
    } catch {
      throw new NotFoundException("站点资源文件不存在。");
    }
    return { filePath, mimeType: asset.mimeType };
  }

  private normalizeKind(kind: string | undefined): SiteAssetKind {
    if (!kind || !Object.values(SiteAssetKind).includes(kind as SiteAssetKind)) {
      throw new BadRequestException("站点资源类型无效。");
    }
    return kind as SiteAssetKind;
  }

  private validateFile(kind: SiteAssetKind, file: UploadedSiteAssetFile): SupportedSiteAssetFormat {
    if (file.size > SITE_ASSET_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException("单个站点资源不能超过 5 MB。");
    }
    const normalizedMimeType = file.mimetype.toLowerCase();
    const originalExtension = extname(file.originalname).toLowerCase();
    const format = SUPPORTED_SITE_ASSET_FORMATS.find((candidate) => candidate.matches(file.buffer));
    if (
      !format ||
      normalizedMimeType !== format.mimeType ||
      !format.extensions.includes(originalExtension) ||
      !format.allowedKinds.includes(kind)
    ) {
      throw new BadRequestException(kind === SiteAssetKind.pwa_icon
        ? "PWA 图标仅支持 PNG、JPEG 或 WebP。"
        : "Logo 仅支持 SVG、PNG、JPEG 或 WebP。");
    }
    return format;
  }

  private resolveStoredPath(storedName: string): string {
    if (!/^(?:logo|pwa_icon)-[0-9a-f-]{36}\.(?:svg|jpg|png|webp)$/i.test(storedName) || basename(storedName) !== storedName) {
      throw new NotFoundException("站点资源不存在。");
    }
    const filePath = resolve(this.uploadDirectory, storedName);
    if (!filePath.startsWith(`${this.uploadDirectory}${process.platform === "win32" ? "\\" : "/"}`)) {
      throw new NotFoundException("站点资源不存在。");
    }
    return filePath;
  }

  private isMissingFileError(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }

  private assetSelect() {
    return {
      id: true,
      kind: true,
      originalName: true,
      storedName: true,
      mimeType: true,
      sizeBytes: true,
      uploadedBy: { select: { id: true, username: true } },
      createdAt: true,
      updatedAt: true,
    } satisfies Prisma.SiteAssetSelect;
  }

  private toResponse(asset: SiteAssetRecord): SiteAssetResponse {
    return {
      id: asset.id,
      kind: asset.kind,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      url: `/site-settings/assets/files/${asset.storedName}`,
      uploadedBy: asset.uploadedBy,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
    };
  }
}
