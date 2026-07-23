import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { access, mkdir, open, rename, unlink } from "node:fs/promises";
import { extname, resolve } from "node:path";
import {
  ChatAttachmentKind,
  FriendshipStatus,
  Prisma,
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  CHAT_ATTACHMENT_MAX_BATCH_SIZE_BYTES,
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  CHAT_IMAGE_MAX_FILE_SIZE_BYTES,
  UploadedChatAttachment,
  chatUploadDirectory,
} from "./chat-attachment.storage";
import { ChatAttachmentResponse } from "./social.types";

const IMAGE_FORMATS = [
  {
    extensions: [".jpg", ".jpeg"],
    extension: ".jpg",
    mimeType: "image/jpeg",
    matches: (buffer: Buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  {
    extensions: [".png"],
    extension: ".png",
    mimeType: "image/png",
    matches: (buffer: Buffer) =>
      buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    extensions: [".webp"],
    extension: ".webp",
    mimeType: "image/webp",
    matches: (buffer: Buffer) =>
      buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP",
  },
] as const;

const DOCUMENT_TYPES = new Map<string, string>([
  [".pdf", "application/pdf"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".odt", "application/vnd.oasis.opendocument.text"],
  [".ods", "application/vnd.oasis.opendocument.spreadsheet"],
  [".odp", "application/vnd.oasis.opendocument.presentation"],
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".csv", "text/csv"],
  [".json", "application/json"],
  [".xml", "application/xml"],
  [".rtf", "application/rtf"],
  [".zip", "application/zip"],
  [".rar", "application/vnd.rar"],
  [".7z", "application/x-7z-compressed"],
  [".gz", "application/gzip"],
  [".tar", "application/x-tar"],
]);

const ZIP_EXTENSIONS = new Set([".zip", ".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp"]);
const OLE_EXTENSIONS = new Set([".doc", ".xls", ".ppt"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json", ".xml", ".rtf"]);

interface PreparedAttachment {
  temporaryPath: string;
  finalPath: string;
  storedName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  kind: ChatAttachmentKind;
}

@Injectable()
export class ChatAttachmentsService {
  private readonly uploadDirectory = chatUploadDirectory();

  constructor(private readonly prisma: PrismaService) {}

  async uploadMany(
    conversationId: number,
    userId: number,
    files: UploadedChatAttachment[] | undefined,
  ): Promise<ChatAttachmentResponse[]> {
    if (!files?.length) {
      throw new BadRequestException("请至少选择一个附件。");
    }
    try {
      await this.assertConversationMember(conversationId, userId);
    } catch (error) {
      await this.cleanupFiles(files);
      throw error;
    }
    if (files.length > CHAT_ATTACHMENT_MAX_FILES) {
      await this.cleanupFiles(files);
      throw new BadRequestException(`单次最多上传 ${CHAT_ATTACHMENT_MAX_FILES} 个附件。`);
    }
    if (files.reduce((total, file) => total + file.size, 0) > CHAT_ATTACHMENT_MAX_BATCH_SIZE_BYTES) {
      await this.cleanupFiles(files);
      throw new BadRequestException("单次上传的附件总大小不能超过 50MB。");
    }

    const prepared: PreparedAttachment[] = [];
    const movedPaths: string[] = [];
    try {
      for (const file of files) {
        prepared.push(await this.prepareFile(file));
      }
      await mkdir(this.uploadDirectory, { recursive: true });
      for (const attachment of prepared) {
        await rename(attachment.temporaryPath, attachment.finalPath);
        movedPaths.push(attachment.finalPath);
      }
      const records = await this.prisma.$transaction(
        prepared.map((attachment, index) => this.prisma.chatAttachment.create({
          data: {
            conversationId,
            uploadedById: userId,
            kind: attachment.kind,
            originalName: attachment.originalName,
            storedName: attachment.storedName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            sortOrder: index,
          },
        })),
      );
      return records.map((record) => this.toResponse(record));
    } catch (error) {
      await Promise.all([
        ...files.map((file) => unlink(file.path).catch(() => undefined)),
        ...movedPaths.map((filePath) => unlink(filePath).catch(() => undefined)),
      ]);
      throw error;
    }
  }

  async getDownload(
    attachmentId: number,
    userId: number,
  ): Promise<{ filePath: string; mimeType: string; originalName: string; sizeBytes: number }> {
    const attachment = await this.prisma.chatAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        conversation: {
          select: {
            friendship: { select: { userOneId: true, userTwoId: true, status: true } },
          },
        },
      },
    });
    if (!attachment) {
      throw new NotFoundException("附件不存在。");
    }
    const friendship = attachment.conversation.friendship;
    if (
      friendship.status !== FriendshipStatus.accepted ||
      ![friendship.userOneId, friendship.userTwoId].includes(userId)
    ) {
      throw new ForbiddenException("没有访问这个附件的权限。");
    }
    if (attachment.messageId === null && attachment.uploadedById !== userId) {
      throw new ForbiddenException("附件尚未发送。");
    }
    const filePath = this.resolveStoredPath(attachment.storedName);
    await access(filePath).catch(() => {
      throw new NotFoundException("附件文件不存在。");
    });
    return {
      filePath,
      mimeType: attachment.mimeType,
      originalName: attachment.originalName,
      sizeBytes: attachment.sizeBytes,
    };
  }

  async bindToMessage(
    transaction: Prisma.TransactionClient,
    userId: number,
    conversationId: number,
    attachmentIds: number[],
    messageId: number,
  ): Promise<void> {
    if (!attachmentIds.length) return;
    if (attachmentIds.length > CHAT_ATTACHMENT_MAX_FILES || new Set(attachmentIds).size !== attachmentIds.length) {
      throw new BadRequestException("附件编号无效或存在重复。");
    }
    const attachments = await transaction.chatAttachment.findMany({
      where: { id: { in: attachmentIds } },
      select: { id: true, conversationId: true, uploadedById: true, messageId: true },
    });
    if (
      attachments.length !== attachmentIds.length ||
      attachments.some((attachment) =>
        attachment.conversationId !== conversationId ||
        attachment.uploadedById !== userId ||
        attachment.messageId !== null,
      )
    ) {
      throw new BadRequestException("附件不存在、已被使用或不属于当前会话。");
    }
    const usedAt = new Date();
    for (const [sortOrder, attachmentId] of attachmentIds.entries()) {
      const result = await transaction.chatAttachment.updateMany({
        where: { id: attachmentId, conversationId, uploadedById: userId, messageId: null },
        data: { messageId, usedAt, sortOrder },
      });
      if (result.count !== 1) {
        throw new BadRequestException("附件已被其他消息使用，请重新上传。");
      }
    }
  }

  private async prepareFile(file: UploadedChatAttachment): Promise<PreparedAttachment> {
    if (file.size < 1 || file.size > CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException("单个普通文件不能超过 20MB。");
    }
    const originalName = this.safeOriginalName(file.originalname);
    const extension = extname(originalName).toLowerCase();
    const header = await this.readHeader(file.path);
    const imageFormat = IMAGE_FORMATS.find((format) => format.matches(header));
    if (imageFormat) {
      if (!imageFormat.extensions.includes(extension as never)) {
        throw new BadRequestException(`图片扩展名与文件内容不一致：${originalName}`);
      }
      if (file.size > CHAT_IMAGE_MAX_FILE_SIZE_BYTES) {
        throw new BadRequestException(`单张图片不能超过 8MB：${originalName}`);
      }
      return this.prepared(file, originalName, imageFormat.extension, imageFormat.mimeType, ChatAttachmentKind.image);
    }
    const mimeType = DOCUMENT_TYPES.get(extension);
    if (!mimeType || !this.matchesDocument(extension, header)) {
      throw new BadRequestException(`不支持或文件内容不符合要求：${originalName}`);
    }
    return this.prepared(file, originalName, extension, mimeType, ChatAttachmentKind.file);
  }

  private prepared(
    file: UploadedChatAttachment,
    originalName: string,
    extension: string,
    mimeType: string,
    kind: ChatAttachmentKind,
  ): PreparedAttachment {
    const storedName = `${randomUUID()}${extension}`;
    return {
      temporaryPath: file.path,
      finalPath: this.resolveStoredPath(storedName),
      storedName,
      originalName,
      mimeType,
      sizeBytes: file.size,
      kind,
    };
  }

  private matchesDocument(extension: string, header: Buffer): boolean {
    if (extension === ".pdf") return header.subarray(0, 5).toString("ascii") === "%PDF-";
    if (ZIP_EXTENSIONS.has(extension)) return header[0] === 0x50 && header[1] === 0x4b;
    if (OLE_EXTENSIONS.has(extension)) {
      return header.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    }
    if (extension === ".rar") return header.subarray(0, 6).toString("ascii") === "Rar!\x1a\x07";
    if (extension === ".7z") return header.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]));
    if (extension === ".gz") return header[0] === 0x1f && header[1] === 0x8b;
    if (extension === ".tar") return header.length >= 262 && header.subarray(257, 262).toString("ascii") === "ustar";
    if (TEXT_EXTENSIONS.has(extension)) return !header.includes(0);
    return false;
  }

  private async readHeader(filePath: string): Promise<Buffer> {
    const handle = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(512);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  private safeOriginalName(originalName: string): string {
    const name = originalName.replace(/\\/g, "/").split("/").at(-1)?.trim().slice(0, 255) ?? "";
    if (!name || name === "." || name === "..") {
      throw new BadRequestException("附件文件名无效。");
    }
    return name;
  }

  private resolveStoredPath(storedName: string): string {
    const filePath = resolve(this.uploadDirectory, storedName);
    const prefix = `${this.uploadDirectory}${process.platform === "win32" ? "\\" : "/"}`;
    if (!filePath.startsWith(prefix)) {
      throw new BadRequestException("附件路径无效。");
    }
    return filePath;
  }

  private async assertConversationMember(conversationId: number, userId: number): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { friendship: { select: { userOneId: true, userTwoId: true, status: true } } },
    });
    if (
      !conversation ||
      conversation.friendship.status !== FriendshipStatus.accepted ||
      ![conversation.friendship.userOneId, conversation.friendship.userTwoId].includes(userId)
    ) {
      throw new ForbiddenException("没有访问这个会话的权限。");
    }
  }

  private cleanupFiles(files: UploadedChatAttachment[]): Promise<void[]> {
    return Promise.all(files.map((file) => unlink(file.path).catch(() => undefined)));
  }

  toResponse(attachment: {
    id: number;
    conversationId: number;
    kind: ChatAttachmentKind;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
  }): ChatAttachmentResponse {
    return {
      id: attachment.id,
      conversationId: attachment.conversationId,
      kind: attachment.kind,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      downloadUrl: `/social/attachments/${attachment.id}/download`,
      createdAt: attachment.createdAt.toISOString(),
    };
  }
}
