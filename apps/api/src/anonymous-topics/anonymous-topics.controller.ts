import { Body, Controller, Get, Headers, Param, ParseIntPipe, Patch, Post, Query, Res, StreamableFile, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { createReadStream } from "node:fs";
import type { Response } from "express";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CHAT_ATTACHMENT_MAX_FILES, CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES, createChatAttachmentStorage } from "../social/chat-attachment.storage";
import type { UploadedChatAttachment } from "../social/chat-attachment.storage";
import { AnonymousTopicsService } from "./anonymous-topics.service";
import {
  ClaimAnonymousIdentityDto,
  CreateAnonymousMessageDto,
  CreateAnonymousTopicDto,
  FavoriteAnonymousTopicDto,
  GetAnonymousTopicQueryDto,
  ListAnonymousTopicsQueryDto,
  ReactAnonymousMessageDto,
  UpdateAnonymousMessageDto,
  UpdateAnonymousTopicByCreatorDto,
  UpdateAnonymousTopicDto,
} from "./dto/anonymous-topic.dto";

@Controller("anonymous-topics")
export class AnonymousTopicsController {
  constructor(private readonly anonymousTopicsService: AnonymousTopicsService) {}

  @Get()
  list(@Query() query: ListAnonymousTopicsQueryDto, @Headers("x-anonymous-visitor-key") visitorKey?: string) {
    return this.anonymousTopicsService.list(query, visitorKey);
  }

  @Post()
  create(@Body() dto: CreateAnonymousTopicDto) { return this.anonymousTopicsService.create(dto); }

  @Post("messages/:messageId/reaction")
  react(@Param("messageId", ParseIntPipe) messageId: number, @Body() dto: ReactAnonymousMessageDto) { return this.anonymousTopicsService.react(messageId, dto); }

  @Post(":id/favorite")
  favorite(@Param("id", ParseIntPipe) id: number, @Body() dto: FavoriteAnonymousTopicDto) {
    return this.anonymousTopicsService.favorite(id, dto);
  }

  @Get("admin")
  @UseGuards(JwtAuthGuard)
  listAdmin(@CurrentUser() user: AuthenticatedUser, @Query() query: ListAnonymousTopicsQueryDto) { return this.anonymousTopicsService.listAdmin(user, query); }

  @Get("admin/:id")
  @UseGuards(JwtAuthGuard)
  getAdmin(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number, @Query() query: GetAnonymousTopicQueryDto) { return this.anonymousTopicsService.getAdmin(user, id, query); }

  @Patch("admin/messages/:id")
  @UseGuards(JwtAuthGuard)
  updateMessage(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number, @Body() dto: UpdateAnonymousMessageDto) { return this.anonymousTopicsService.updateMessage(user, id, dto); }

  @Patch("admin/:id")
  @UseGuards(JwtAuthGuard)
  updateTopic(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number, @Body() dto: UpdateAnonymousTopicDto) { return this.anonymousTopicsService.updateTopic(user, id, dto); }

  @Patch(":id/status")
  updateTopicByCreator(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateAnonymousTopicByCreatorDto) { return this.anonymousTopicsService.updateTopicByCreator(id, dto); }

  @Get(":id")
  get(
    @Param("id", ParseIntPipe) id: number,
    @Query() query: GetAnonymousTopicQueryDto,
    @Headers("x-anonymous-visitor-key") visitorKey?: string,
  ) { return this.anonymousTopicsService.get(id, query, visitorKey); }

  @Get("attachments/:id/download")
  async downloadAttachment(
    @Param("id", ParseIntPipe) id: number,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const attachment = await this.anonymousTopicsService.getAttachment(id);
    const fallbackName = attachment.originalName.replace(/[^A-Za-z0-9._-]/g, "_") || "attachment";
    response.set({
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
      "Content-Length": String(attachment.sizeBytes),
      "Content-Security-Policy": "sandbox",
      "Content-Type": attachment.mimeType,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    return new StreamableFile(createReadStream(attachment.filePath));
  }

  @Get("attachments/:id/thumbnail")
  async downloadAttachmentThumbnail(
    @Param("id", ParseIntPipe) id: number,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const thumbnail = await this.anonymousTopicsService.getAttachment(id, true);
    response.set({ "Cache-Control": "private, max-age=86400", "Content-Length": String(thumbnail.sizeBytes), "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff" });
    return new StreamableFile(createReadStream(thumbnail.filePath));
  }

  @Post(":id/identity")
  claimIdentity(@Param("id", ParseIntPipe) id: number, @Body() dto: ClaimAnonymousIdentityDto) { return this.anonymousTopicsService.claimIdentity(id, dto); }

  @Post(":id/messages")
  @UseInterceptors(
    FilesInterceptor("files", CHAT_ATTACHMENT_MAX_FILES, {
      storage: createChatAttachmentStorage(),
      limits: { files: CHAT_ATTACHMENT_MAX_FILES, fileSize: CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES },
    }),
  )
  createMessage(@Param("id", ParseIntPipe) id: number, @Body() dto: CreateAnonymousMessageDto, @UploadedFiles() files: UploadedChatAttachment[] | undefined) { return this.anonymousTopicsService.createMessage(id, dto, files); }
}
