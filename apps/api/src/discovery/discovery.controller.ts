import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { createReadStream } from "node:fs";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import { DiscoveryService, TOPIC_COVER_MAX_FILE_SIZE_BYTES } from "./discovery.service";
import {
  CreateArticleCollectionDto,
  CreateArticleTopicDto,
  ListCollectionsQueryDto,
  ListDiscoveryQueryDto,
  ListSubscriptionFeedQueryDto,
  ReorderContentItemsDto,
  UpdateArticleCollectionDto,
  UpdateArticleTopicDto,
  UpdateAuthorSubscriptionDto,
  UpdateProfileSettingsDto,
} from "./dto/discovery.dto";
import type { UploadedTopicCover } from "./discovery.types";

@Controller("discovery")
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  @Get("feed")
  @UseGuards(JwtAuthGuard)
  listFeed(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListSubscriptionFeedQueryDto,
  ) {
    return this.discoveryService.listSubscriptionFeed(user, query);
  }

  @Post("feed/read-all")
  @UseGuards(JwtAuthGuard)
  markAllFeedRead(@CurrentUser() user: AuthenticatedUser) {
    return this.discoveryService.markAllSubscriptionFeedRead(user);
  }

  @Post("feed/:articleId/read")
  @UseGuards(JwtAuthGuard)
  markFeedRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param("articleId", ParseIntPipe) articleId: number,
  ) {
    return this.discoveryService.markSubscriptionFeedRead(user, articleId);
  }

  @Get("subscriptions/settings")
  @UseGuards(JwtAuthGuard)
  listSubscriptionSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.discoveryService.listSubscriptionSettings(user);
  }

  @Patch("subscriptions/:authorId/settings")
  @UseGuards(JwtAuthGuard)
  updateSubscriptionSetting(
    @CurrentUser() user: AuthenticatedUser,
    @Param("authorId", ParseIntPipe) authorId: number,
    @Body() dto: UpdateAuthorSubscriptionDto,
  ) {
    return this.discoveryService.updateSubscriptionSetting(user, authorId, dto.notifyNewArticles);
  }

  @Get("collections/mine")
  @UseGuards(JwtAuthGuard)
  listMyCollections(@CurrentUser() user: AuthenticatedUser) {
    return this.discoveryService.listMyCollections(user);
  }

  @Get("collections")
  listPublicCollections(@Query() query: ListCollectionsQueryDto) {
    return this.discoveryService.listCollections(query, null);
  }

  @Get("collections/visible")
  @UseGuards(JwtAuthGuard)
  listVisibleCollections(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCollectionsQueryDto,
  ) {
    return this.discoveryService.listCollections(query, user);
  }

  @Post("collections")
  @UseGuards(JwtAuthGuard)
  createCollection(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateArticleCollectionDto,
  ) {
    return this.discoveryService.createCollection(user, dto);
  }

  @Patch("collections/:id")
  @UseGuards(JwtAuthGuard)
  updateCollection(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateArticleCollectionDto,
  ) {
    return this.discoveryService.updateCollection(user, id, dto);
  }

  @Delete("collections/:id")
  @UseGuards(JwtAuthGuard)
  deleteCollection(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.discoveryService.deleteCollection(user, id);
  }

  @Post("collections/:id/articles/:articleId")
  @UseGuards(JwtAuthGuard)
  addCollectionArticle(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Param("articleId", ParseIntPipe) articleId: number,
  ) {
    return this.discoveryService.addCollectionArticle(user, id, articleId);
  }

  @Delete("collections/:id/articles/:articleId")
  @UseGuards(JwtAuthGuard)
  removeCollectionArticle(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Param("articleId", ParseIntPipe) articleId: number,
  ) {
    return this.discoveryService.removeCollectionArticle(user, id, articleId);
  }

  @Patch("collections/:id/articles/order")
  @UseGuards(JwtAuthGuard)
  reorderCollectionArticles(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ReorderContentItemsDto,
  ) {
    return this.discoveryService.reorderCollectionArticles(user, id, dto);
  }

  @Get("collections/public/:id")
  getPublicCollection(@Param("id", ParseIntPipe) id: number) {
    return this.discoveryService.getCollection(id, null);
  }

  @Get("collections/visible/:id")
  @UseGuards(JwtAuthGuard)
  getVisibleCollection(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.discoveryService.getCollection(id, user);
  }

  @Get("topics")
  listPublicTopics(@Query() query: ListDiscoveryQueryDto) {
    return this.discoveryService.listTopics(query, null);
  }

  @Get("topics/covers/:storedName")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  async getTopicCover(@Param("storedName") storedName: string): Promise<StreamableFile> {
    const file = await this.discoveryService.getTopicCover(storedName);
    return new StreamableFile(createReadStream(file.filePath), {
      length: file.sizeBytes,
      type: file.mimeType,
    });
  }

  @Get("topics/visible")
  @UseGuards(JwtAuthGuard)
  listVisibleTopics(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDiscoveryQueryDto,
  ) {
    return this.discoveryService.listTopics(query, user);
  }

  @Get("topics/public/:slug")
  getPublicTopic(@Param("slug") slug: string) {
    return this.discoveryService.getTopic(slug, null);
  }

  @Get("topics/visible/:slug")
  @UseGuards(JwtAuthGuard)
  getVisibleTopic(@CurrentUser() user: AuthenticatedUser, @Param("slug") slug: string) {
    return this.discoveryService.getTopic(slug, user);
  }

  @Get("admin/topics")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  listAdminTopics(@CurrentUser() user: AuthenticatedUser) {
    return this.discoveryService.listAdminTopics(user);
  }

  @Post("admin/topics")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  createTopic(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateArticleTopicDto) {
    return this.discoveryService.createTopic(user, dto);
  }

  @Post("admin/topics/:id/cover")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: TOPIC_COVER_MAX_FILE_SIZE_BYTES } }))
  uploadTopicCover(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @UploadedFile() file: UploadedTopicCover | undefined,
  ) {
    return this.discoveryService.uploadTopicCover(user, id, file);
  }

  @Patch("admin/topics/:id")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  updateTopic(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateArticleTopicDto,
  ) {
    return this.discoveryService.updateTopic(user, id, dto);
  }

  @Delete("admin/topics/:id")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  deleteTopic(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.discoveryService.deleteTopic(user, id);
  }

  @Post("admin/topics/:id/articles/:articleId")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  addTopicArticle(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Param("articleId", ParseIntPipe) articleId: number,
  ) {
    return this.discoveryService.addTopicArticle(user, id, articleId);
  }

  @Delete("admin/topics/:id/articles/:articleId")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  removeTopicArticle(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Param("articleId", ParseIntPipe) articleId: number,
  ) {
    return this.discoveryService.removeTopicArticle(user, id, articleId);
  }

  @Patch("admin/topics/:id/articles/order")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  reorderTopicArticles(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ReorderContentItemsDto,
  ) {
    return this.discoveryService.reorderTopicArticles(user, id, dto);
  }

  @Get("profile/settings")
  @UseGuards(JwtAuthGuard)
  getProfileSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.discoveryService.getProfileSettings(user);
  }

  @Patch("profile/settings")
  @UseGuards(JwtAuthGuard)
  updateProfileSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileSettingsDto,
  ) {
    return this.discoveryService.updateProfileSettings(user, dto);
  }

  @Get("profiles/public/:username")
  getPublicProfileShowcase(
    @Param("username") username: string,
    @Req() request: Request,
  ) {
    return this.discoveryService.getProfileShowcase(
      username,
      null,
      this.visitorKey(request),
    );
  }

  @Get("profiles/visible/:username")
  @UseGuards(JwtAuthGuard)
  getVisibleProfileShowcase(
    @Param("username") username: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.discoveryService.getProfileShowcase(
      username,
      user,
      this.visitorKey(request, user.id),
    );
  }

  private visitorKey(request: Request, viewerId?: number): string {
    const forwardedFor = request.headers["x-forwarded-for"];
    const ip = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(",")[0] ?? request.ip ?? "unknown";
    return this.discoveryService.createVisitorKey(
      request.headers["user-agent"] ?? "unknown",
      ip.trim(),
      viewerId,
    );
  }
}
