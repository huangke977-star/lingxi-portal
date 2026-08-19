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
  NotificationIdsDto,
  CreateStrangerMessageRequestDto,
  RequestFriendDto,
  RespondFriendRequestDto,
  RespondStrangerMessageRequestDto,
  SearchSocialUsersQueryDto,
  UpdateConversationSettingsDto,
  UpdateNotificationChannelSettingsDto,
} from "./dto/social.dto";
import {
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  UploadedChatAttachment,
  createChatAttachmentStorage,
} from "./chat-attachment.storage";
import { ChatAttachmentsService } from "./chat-attachments.service";
import { CallsService } from "./calls.service";
import { SocialService } from "./social.service";

@Controller("social")
@UseGuards(JwtAuthGuard)
export class SocialController {
  constructor(
    private readonly socialService: SocialService,
    private readonly chatAttachmentsService: ChatAttachmentsService,
    private readonly callsService: CallsService,
  ) {}

  @Get("profiles/:id")
  getProfile(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.getProfile(user, id);
  }

  @Get("friends")
  listFriends(@CurrentUser() user: AuthenticatedUser) {
    return this.socialService.listFriendships(user);
  }

  @Get("users/search")
  searchUsers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchSocialUsersQueryDto,
  ) {
    return this.socialService.searchUsers(user, query);
  }

  @Post("subscriptions/:id")
  subscribe(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.subscribe(user, id);
  }

  @Delete("subscriptions/:id")
  unsubscribe(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.unsubscribe(user, id);
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

  @Post("users/:id/block")
  blockUser(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.blockUser(user, id);
  }

  @Get("stranger-message-requests")
  listStrangerMessageRequests(@CurrentUser() user: AuthenticatedUser) {
    return this.socialService.listStrangerMessageRequests(user);
  }

  @Post("stranger-message-requests/:id")
  createStrangerMessageRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: CreateStrangerMessageRequestDto,
  ) {
    return this.socialService.createStrangerMessageRequest(user, id, dto.body);
  }

  @Patch("stranger-message-requests/:id/respond")
  respondStrangerMessageRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: RespondStrangerMessageRequestDto,
  ) {
    return this.socialService.respondStrangerMessageRequest(user, id, dto.status);
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
  markAllNotificationsRead(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.socialService.markAllNotificationsRead(user, query.channel);
  }

  @Post("notifications/read-selected")
  markSelectedNotificationsRead(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: NotificationIdsDto,
  ) {
    return this.socialService.markSelectedNotificationsRead(user, dto.notificationIds);
  }

  @Post("notifications/delete-selected")
  deleteSelectedNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: NotificationIdsDto,
  ) {
    return this.socialService.deleteSelectedNotifications(user, dto.notificationIds);
  }

  @Delete("notifications/:id")
  deleteNotification(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.deleteNotification(user, id);
  }

  @Delete("notifications")
  clearNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.socialService.clearNotifications(user, query.channel);
  }

  @Delete("notification-channels/:channel")
  hideNotificationChannel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("channel") channel: string,
  ) {
    return this.socialService.hideNotificationChannel(user, channel);
  }

  @Patch("notification-channels/:channel/settings")
  updateNotificationChannelSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Param("channel") channel: string,
    @Body() dto: UpdateNotificationChannelSettingsDto,
  ) {
    return this.socialService.updateNotificationChannelSettings(user, channel, dto);
  }

  @Get("conversations")
  listConversations(@CurrentUser() user: AuthenticatedUser) {
    return this.socialService.listConversations(user);
  }

  @Get("calls/ice-servers")
  getCallIceServers(@CurrentUser() user: AuthenticatedUser) {
    return this.callsService.getIceServers(user.id);
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

  @Patch("conversations/:id/settings")
  updateConversationSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateConversationSettingsDto,
  ) {
    return this.socialService.updateConversationSettings(user, id, dto);
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
    const attachment = await this.chatAttachmentsService.getDownload(id, user);
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
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const thumbnail = await this.chatAttachmentsService.getThumbnail(id, user);
    response.set({
      "Cache-Control": "private, max-age=86400",
      "Content-Length": String(thumbnail.sizeBytes),
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
    });
    return new StreamableFile(createReadStream(thumbnail.filePath));
  }
}
