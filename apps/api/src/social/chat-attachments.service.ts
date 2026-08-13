import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { extname, resolve } from "node:path";
import sharp from "sharp";
import {
  ChatAttachmentKind,
  ChatGroupMemberStatus,
  ChatGroupStatus,
  FriendshipStatus,
  Prisma,
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  CHAT_ATTACHMENT_MAX_BATCH_SIZE_BYTES,
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  CHAT_AUDIO_MAX_FILE_SIZE_BYTES,
  CHAT_IMAGE_MAX_FILE_SIZE_BYTES,
  CHAT_VIDEO_MAX_FILE_SIZE_BYTES,
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
const AUDIO_EXTENSIONS = new Set([".webm", ".m4a", ".mp3", ".wav", ".ogg"]);
const VIDEO_EXTENSIONS = new Set([".webm", ".mp4", ".mov"]);

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
  ): Promise<{ filePath: string; mimeType: string; originalName: string; sizeBytes: number; storedName: string; kind: ChatAttachmentKind }> {
    const attachment = await this.prisma.chatAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        conversation: {
          select: {
            friendship: { select: { userOneId: true, userTwoId: true, status: true } },
            group: {
              select: {
                status: true,
                expiresAt: true,
                members: { where: { userId }, select: { status: true } },
              },
            },
          },
        },
      },
    });
    if (!attachment) {
      throw new NotFoundException("附件不存在。");
    }
    const { friendship, group } = attachment.conversation;
    const directMember = Boolean(
      friendship &&
      friendship.status === FriendshipStatus.accepted &&
      [friendship.userOneId, friendship.userTwoId].includes(userId),
    );
    const groupMember = Boolean(
      group &&
      group.status === ChatGroupStatus.active &&
      (!group.expiresAt || group.expiresAt > new Date()) &&
      group.members[0]?.status === ChatGroupMemberStatus.active,
    );
    if (!directMember && !groupMember) {
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
      originalName: this.safeOriginalName(attachment.originalName),
      sizeBytes: attachment.sizeBytes,
      storedName: attachment.storedName,
      kind: attachment.kind,
    };
  }

  async getThumbnail(
    attachmentId: number,
    userId: number,
  ): Promise<{ filePath: string; sizeBytes: number }> {
    const attachment = await this.getDownload(attachmentId, userId);
    if (attachment.kind !== ChatAttachmentKind.image) {
      throw new NotFoundException("图片缩略图不存在。");
    }
    const thumbnailPath = this.resolveStoredPath(this.thumbnailStoredName(attachment.storedName));
    await access(thumbnailPath).catch(async () => {
      const temporaryPath = `${thumbnailPath}.${randomUUID()}.tmp`;
      try {
        await sharp(attachment.filePath)
          .rotate()
          .resize(480, 480, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 72, effort: 4 })
          .toFile(temporaryPath);
        await rename(temporaryPath, thumbnailPath);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        if (await access(thumbnailPath).then(() => true).catch(() => false)) return;
        throw error;
      }
    });
    return { filePath: thumbnailPath, sizeBytes: (await stat(thumbnailPath)).size };
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

  async cloneToMessage(
    transaction: Prisma.TransactionClient,
    userId: number,
    conversationId: number,
    messageId: number,
    attachments: Array<{
      kind: ChatAttachmentKind;
      originalName: string;
      storedName: string;
      mimeType: string;
      sizeBytes: number;
      sortOrder: number;
    }>,
  ): Promise<string[]> {
    if (!attachments.length) return [];
    await mkdir(this.uploadDirectory, { recursive: true });
    const copiedStoredNames: string[] = [];
    try {
      for (const [index, attachment] of attachments.entries()) {
        const storedName = `${randomUUID()}${extname(attachment.storedName).toLowerCase()}`;
        await copyFile(this.resolveStoredPath(attachment.storedName), this.resolveStoredPath(storedName));
        copiedStoredNames.push(storedName);
        await transaction.chatAttachment.create({
          data: {
            conversationId,
            uploadedById: userId,
            messageId,
            kind: attachment.kind,
            originalName: attachment.originalName,
            storedName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            sortOrder: attachment.sortOrder ?? index,
            usedAt: new Date(),
          },
        });
      }
      return copiedStoredNames;
    } catch (error) {
      await this.deleteStoredFiles(copiedStoredNames);
      throw error;
    }
  }

  async deleteStoredFiles(storedNames: string[]): Promise<void> {
    await Promise.all(
      Array.from(new Set(storedNames)).flatMap((storedName) =>
        [storedName, this.thumbnailStoredName(storedName)].map((name) =>
          unlink(this.resolveStoredPath(name)).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          }),
        ),
      ),
    );
  }

  private async prepareFile(file: UploadedChatAttachment): Promise<PreparedAttachment> {
    if (file.size < 1 || file.size > CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException("单个附件不能超过 50MB。");
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
    if (file.mimetype.startsWith("audio/") && AUDIO_EXTENSIONS.has(extension) && this.matchesAudio(extension, header)) {
      if (file.size > CHAT_AUDIO_MAX_FILE_SIZE_BYTES) {
        throw new BadRequestException(`单个音频不能超过 20MB：${originalName}`);
      }
      return this.prepared(
        file,
        originalName,
        extension,
        this.audioMimeType(extension),
        ChatAttachmentKind.audio,
      );
    }
    if (file.mimetype.startsWith("video/") && VIDEO_EXTENSIONS.has(extension) && this.matchesVideo(extension, header)) {
      if (file.size > CHAT_VIDEO_MAX_FILE_SIZE_BYTES) {
        throw new BadRequestException(`单个视频不能超过 50MB：${originalName}`);
      }
      return this.prepared(
        file,
        originalName,
        extension,
        this.videoMimeType(extension),
        ChatAttachmentKind.video,
      );
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

  private matchesAudio(extension: string, header: Buffer): boolean {
    if (extension === ".webm") return this.isEbml(header);
    if (extension === ".m4a") return this.isIsoBaseMedia(header);
    if (extension === ".mp3") {
      return header.subarray(0, 3).toString("ascii") === "ID3" ||
        (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
    }
    if (extension === ".wav") {
      return header.subarray(0, 4).toString("ascii") === "RIFF" &&
        header.subarray(8, 12).toString("ascii") === "WAVE";
    }
    if (extension === ".ogg") return header.subarray(0, 4).toString("ascii") === "OggS";
    return false;
  }

  private matchesVideo(extension: string, header: Buffer): boolean {
    if (extension === ".webm") return this.isEbml(header);
    if (extension === ".mp4" || extension === ".mov") return this.isIsoBaseMedia(header);
    return false;
  }

  private isEbml(header: Buffer): boolean {
    return header.length >= 4 && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  }

  private isIsoBaseMedia(header: Buffer): boolean {
    return header.length >= 12 && header.subarray(4, 8).toString("ascii") === "ftyp";
  }

  private audioMimeType(extension: string): string {
    if (extension === ".webm") return "audio/webm";
    if (extension === ".m4a") return "audio/mp4";
    if (extension === ".mp3") return "audio/mpeg";
    if (extension === ".wav") return "audio/wav";
    return "audio/ogg";
  }

  private videoMimeType(extension: string): string {
    if (extension === ".webm") return "video/webm";
    if (extension === ".mov") return "video/quicktime";
    return "video/mp4";
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
    const decodedName = this.decodeMultipartFilename(originalName);
    const name = Array.from(decodedName)
      .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join("")
      .replace(/\\/g, "/")
      .split("/")
      .at(-1)
      ?.trim()
      .slice(0, 255) ?? "";
    if (!name || name === "." || name === "..") {
      throw new BadRequestException("附件文件名无效。");
    }
    return name;
  }

  private decodeMultipartFilename(originalName: string): string {
    const bytes = Buffer.from(originalName, "latin1");
    const decoded = bytes.toString("utf8");
    return !decoded.includes("\uFFFD") && Buffer.from(decoded, "utf8").equals(bytes)
      ? decoded
      : originalName;
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
      select: {
        friendship: { select: { userOneId: true, userTwoId: true, status: true } },
        group: {
          select: {
            status: true,
            expiresAt: true,
            isBanned: true,
            bannedUntil: true,
            members: { where: { userId }, select: { status: true, mutedUntil: true } },
          },
        },
      },
    });
    const directMember = Boolean(
      conversation?.friendship &&
      conversation.friendship.status === FriendshipStatus.accepted &&
      [conversation.friendship.userOneId, conversation.friendship.userTwoId].includes(userId),
    );
    const groupMember = Boolean(
      conversation?.group &&
      conversation.group.status === ChatGroupStatus.active &&
      (!conversation.group.expiresAt || conversation.group.expiresAt > new Date()) &&
      (!conversation.group.isBanned || (conversation.group.bannedUntil !== null && conversation.group.bannedUntil <= new Date())) &&
      conversation.group.members[0]?.status === ChatGroupMemberStatus.active &&
      (!conversation.group.members[0]?.mutedUntil || conversation.group.members[0].mutedUntil <= new Date()),
    );
    if (!conversation || (!directMember && !groupMember)) {
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
      originalName: this.safeOriginalName(attachment.originalName),
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      downloadUrl: `/social/attachments/${attachment.id}/download`,
      thumbnailUrl: attachment.kind === ChatAttachmentKind.image
        ? `/social/attachments/${attachment.id}/thumbnail`
        : null,
      createdAt: attachment.createdAt.toISOString(),
    };
  }

  private thumbnailStoredName(storedName: string): string {
    return `${storedName}.thumb.webp`;
  }
}
