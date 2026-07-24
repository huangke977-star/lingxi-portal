import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatAttachmentKind, FriendshipStatus } from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { UploadedChatAttachment } from "../src/social/chat-attachment.storage";
import { ChatAttachmentsService } from "../src/social/chat-attachments.service";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function uploaded(path: string, originalname: string, size: number): UploadedChatAttachment {
  return {
    fieldname: "files",
    originalname,
    encoding: "7bit",
    mimetype: "application/octet-stream",
    destination: join(path, ".."),
    filename: path.split(/[\\/]/).at(-1) ?? "upload",
    path,
    size,
  };
}

describe("ChatAttachmentsService", () => {
  let uploadDirectory: string;

  beforeEach(async () => {
    uploadDirectory = await mkdtemp(join(tmpdir(), "hlovet-chat-attachments-"));
    process.env.CHAT_UPLOAD_DIR = uploadDirectory;
  });

  afterEach(async () => {
    await rm(uploadDirectory, { recursive: true, force: true });
    delete process.env.CHAT_UPLOAD_DIR;
  });

  it("moves validated image uploads to managed storage without buffering the batch in memory", async () => {
    const temporaryPath = join(uploadDirectory, "image.upload");
    await writeFile(temporaryPath, onePixelPng);
    const createdAt = new Date("2026-07-23T12:00:00.000Z");
    const prisma = {
      conversation: {
        findUnique: jest.fn(async () => ({
          friendship: { userOneId: 7, userTwoId: 8, status: FriendshipStatus.accepted },
        })),
      },
      chatAttachment: {
        create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
          id: 1,
          createdAt,
          ...args.data,
        })),
      },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const service = new ChatAttachmentsService(prisma as unknown as PrismaService);

    const result = await service.uploadMany(5, 7, [uploaded(temporaryPath, "avatar.png", onePixelPng.length)]);

    expect(result).toEqual([expect.objectContaining({
      id: 1,
      conversationId: 5,
      kind: ChatAttachmentKind.image,
      mimeType: "image/png",
      downloadUrl: "/social/attachments/1/download",
    })]);
    expect(prisma.chatAttachment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ uploadedById: 7, originalName: "avatar.png" }),
    }));
  });

  it("rejects and cleans a batch larger than 50MB", async () => {
    const firstPath = join(uploadDirectory, "first.upload");
    const secondPath = join(uploadDirectory, "second.upload");
    await Promise.all([writeFile(firstPath, "first"), writeFile(secondPath, "second")]);
    const prisma = {
      conversation: {
        findUnique: jest.fn(async () => ({
          friendship: { userOneId: 7, userTwoId: 8, status: FriendshipStatus.accepted },
        })),
      },
    };
    const service = new ChatAttachmentsService(prisma as unknown as PrismaService);

    await expect(service.uploadMany(5, 7, [
      uploaded(firstPath, "first.zip", 26 * 1024 * 1024),
      uploaded(secondPath, "second.zip", 26 * 1024 * 1024),
    ])).rejects.toBeInstanceOf(BadRequestException);
  });

  it("atomically binds only unused attachments owned by the sender and conversation", async () => {
    const transaction = {
      chatAttachment: {
        findMany: jest.fn(async () => [
          { id: 10, conversationId: 5, uploadedById: 7, messageId: null },
          { id: 11, conversationId: 5, uploadedById: 7, messageId: null },
        ]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const service = new ChatAttachmentsService({} as PrismaService);

    await service.bindToMessage(transaction as never, 7, 5, [11, 10], 20);

    expect(transaction.chatAttachment.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ id: 11, messageId: null }),
      data: expect.objectContaining({ messageId: 20, sortOrder: 0 }),
    }));
    expect(transaction.chatAttachment.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: 10, messageId: null }),
      data: expect.objectContaining({ messageId: 20, sortOrder: 1 }),
    }));
  });

  it("does not expose an unused attachment to the other conversation member", async () => {
    const prisma = {
      chatAttachment: {
        findUnique: jest.fn(async () => ({
          id: 1,
          uploadedById: 7,
          messageId: null,
          conversation: {
            friendship: { userOneId: 7, userTwoId: 8, status: FriendshipStatus.accepted },
          },
        })),
      },
    };
    const service = new ChatAttachmentsService(prisma as unknown as PrismaService);

    await expect(service.getDownload(1, 8)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("restores UTF-8 Chinese names decoded as latin1 by multipart parsing", () => {
    const service = new ChatAttachmentsService({} as PrismaService);
    const originalName = "我的表格.xlsx";
    const mojibakeName = Buffer.from(originalName, "utf8").toString("latin1");

    const result = service.toResponse({
      id: 1,
      conversationId: 5,
      kind: ChatAttachmentKind.file,
      originalName: mojibakeName,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 1024,
      createdAt: new Date("2026-07-24T00:00:00.000Z"),
    });

    expect(result.originalName).toBe(originalName);
  });
});
