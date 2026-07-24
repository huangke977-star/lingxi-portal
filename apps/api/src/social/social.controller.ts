import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { createReadStream } from "node:fs";
import type { Response } from "express";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
  ListMessagesQueryDto,
  ListNotificationsQueryDto,
  RequestFriendDto,
  RespondFriendRequestDto,
} from "./dto/social.dto";
import {
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  UploadedChatAttachment,
  createChatAttachmentStorage,
} from "./chat-attachment.storage";
import { ChatAttachmentsService } from "./chat-attachments.service";
import { SocialService } from "./social.service";

@Controller("social")
@UseGuards(JwtAuthGuard)
export class SocialController {
  constructor(
    private readonly socialService: SocialService,
    private readonly chatAttachmentsService: ChatAttachmentsService,
  ) {}

  @Get("profiles/:id")
  getProfile(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.getProfile(user, id);
  }

  @Get("friends")
  listFriends(@CurrentUser() user: AuthenticatedUser) {
    return this.socialService.listFriendships(user);
  }

  @Post("friends/:id/request")
  requestFriend(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: RequestFriendDto,
  ) {
    return this.socialService.requestFriend(user, id, dto.note);
  }

  @Patch("friendships/:id/respond")
  respondFriendRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: RespondFriendRequestDto,
  ) {
    return this.socialService.respondFriendRequest(user, id, dto.status);
  }

  @Delete("friendships/:id")
  removeFriendship(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.removeFriendship(user, id);
  }

  @Post("friendships/:id/block")
  blockFriendship(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.blockFriendship(user, id);
  }

  @Delete("friendships/:id/block")
  unblockFriendship(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.unblockFriendship(user, id);
  }

  @Get("summary")
  getSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.socialService.getSummary(user);
  }

  @Get("notifications")
  listNotifications(@CurrentUser() user: AuthenticatedUser, @Query() query: ListNotificationsQueryDto) {
    return this.socialService.listNotifications(user, query);
  }

  @Patch("notifications/:id/read")
  markNotificationRead(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.markNotificationRead(user, id);
  }

  @Post("notifications/read-all")
  markAllNotificationsRead(@CurrentUser() user: AuthenticatedUser) {
    return this.socialService.markAllNotificationsRead(user);
  }

  @Get("conversations")
  listConversations(@CurrentUser() user: AuthenticatedUser) {
    return this.socialService.listConversations(user);
  }

  @Post("conversations/with/:id")
  getOrCreateConversation(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.getOrCreateConversation(user, id);
  }

  @Get("conversations/:id/messages")
  listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.socialService.listMessages(user, id, query);
  }

  @Post("conversations/:id/read")
  markRead(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.markConversationRead(user.id, id);
  }

  @Post("conversations/:id/attachments")
  @UseInterceptors(
    FilesInterceptor("files", CHAT_ATTACHMENT_MAX_FILES, {
      storage: createChatAttachmentStorage(),
      limits: { files: CHAT_ATTACHMENT_MAX_FILES, fileSize: CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES },
    }),
  )
  uploadAttachments(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @UploadedFiles() files: UploadedChatAttachment[] | undefined,
  ) {
    return this.chatAttachmentsService.uploadMany(id, user.id, files);
  }

  @Get("attachments/:id/download")
  async downloadAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const attachment = await this.chatAttachmentsService.getDownload(id, user.id);
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
}
