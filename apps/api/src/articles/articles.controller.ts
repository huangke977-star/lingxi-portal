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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { createReadStream } from "node:fs";
import type { Request } from "express";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import {
  ARTICLE_IMAGE_MAX_FILE_SIZE_BYTES,
  ARTICLE_IMAGE_MAX_FILES_PER_ARTICLE,
  ArticlesService,
  UploadedArticleImage,
} from "./articles.service";
import {
  CreateArticleCommentDto,
  CreateArticleDto,
  ListArticlesQueryDto,
  ModerateArticleCommentDto,
  ModerateArticleDto,
  UpdateArticleDto,
} from "./dto/article.dto";

@Controller("articles")
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  listPublic(@Query() query: ListArticlesQueryDto) {
    return this.articlesService.listPublic(query);
  }

  @Get("visible")
  @UseGuards(JwtAuthGuard)
  listVisible(
    @Query() query: ListArticlesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articlesService.listVisible(query, user);
  }

  @Get("center/summary")
  getPublicCenterSummary() {
    return this.articlesService.getCenterSummary(null);
  }

  @Get("visible/center/summary")
  @UseGuards(JwtAuthGuard)
  getVisibleCenterSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.getCenterSummary(user);
  }

  @Get("mine")
  @UseGuards(JwtAuthGuard)
  listMine(
    @Query() query: ListArticlesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articlesService.listMine(query, user);
  }

  @Get("mine/summary")
  @UseGuards(JwtAuthGuard)
  getMineSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.getMineSummary(user);
  }

  @Get("mine/:id")
  @UseGuards(JwtAuthGuard)
  getMineById(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articlesService.getMineById(id, user);
  }

  @Get("favorites")
  @UseGuards(JwtAuthGuard)
  listFavorites(
    @Query() query: ListArticlesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articlesService.listFavorites(query, user);
  }

  @Get("liked")
  @UseGuards(JwtAuthGuard)
  listLiked(
    @Query() query: ListArticlesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articlesService.listLiked(query, user);
  }

  @Get("admin")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  listAdmin(@Query() query: ListArticlesQueryDto) {
    return this.articlesService.listAdmin(query);
  }

  @Get("admin/comments")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  listAdminComments(@Query("articleId") articleId?: string) {
    const parsedArticleId = articleId ? Number(articleId) : undefined;
    return this.articlesService.listAdminComments(
      parsedArticleId && Number.isInteger(parsedArticleId) ? parsedArticleId : undefined,
    );
  }

  @Get("images/:storedName")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  async getImage(@Param("storedName") storedName: string): Promise<StreamableFile> {
    const file = await this.articlesService.getImage(storedName);
    return new StreamableFile(createReadStream(file.filePath), { type: file.mimeType });
  }

  @Get("visible/:slug")
  @UseGuards(JwtAuthGuard)
  getVisible(
    @Param("slug") slug: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.articlesService.getVisibleBySlug(
      slug,
      user,
      this.visitorKey(request, user.id),
    );
  }

  @Get(":slug/comments")
  listComments(@Param("slug") slug: string) {
    return this.articlesService.listComments(slug, null);
  }

  @Get("visible/:slug/comments")
  @UseGuards(JwtAuthGuard)
  listVisibleComments(
    @Param("slug") slug: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articlesService.listComments(slug, user);
  }

  @Get(":slug")
  getPublic(@Param("slug") slug: string, @Req() request: Request) {
    return this.articlesService.getPublicBySlug(slug, this.visitorKey(request));
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateArticleDto) {
    return this.articlesService.create(user, dto);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  update(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.articlesService.update(id, user, dto);
  }

  @Post(":id/publish")
  @UseGuards(JwtAuthGuard)
  publish(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.publish(id, user);
  }

  @Post(":id/unpublish")
  @UseGuards(JwtAuthGuard)
  unpublish(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.unpublish(id, user);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  delete(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.delete(id, user);
  }

  @Post(":id/restore")
  @UseGuards(JwtAuthGuard)
  restore(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.restore(id, user);
  }

  @Delete(":id/permanent")
  @UseGuards(JwtAuthGuard)
  permanentlyDelete(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articlesService.permanentlyDelete(id, user);
  }

  @Post(":id/images")
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor("files", ARTICLE_IMAGE_MAX_FILES_PER_ARTICLE, {
      limits: {
        fileSize: ARTICLE_IMAGE_MAX_FILE_SIZE_BYTES,
        files: ARTICLE_IMAGE_MAX_FILES_PER_ARTICLE,
      },
    }),
  )
  uploadImages(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files: UploadedArticleImage[] | undefined,
  ) {
    return this.articlesService.uploadImages(id, user, files);
  }

  @Post(":id/like")
  @UseGuards(JwtAuthGuard)
  like(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.toggleLike(id, user, true);
  }

  @Delete(":id/like")
  @UseGuards(JwtAuthGuard)
  unlike(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.toggleLike(id, user, false);
  }

  @Post(":id/favorite")
  @UseGuards(JwtAuthGuard)
  favorite(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.toggleFavorite(id, user, true);
  }

  @Delete(":id/favorite")
  @UseGuards(JwtAuthGuard)
  unfavorite(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.toggleFavorite(id, user, false);
  }

  @Post(":id/comments")
  @UseGuards(JwtAuthGuard)
  createComment(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateArticleCommentDto,
  ) {
    return this.articlesService.createComment(id, user, dto);
  }

  @Delete("comments/:id")
  @UseGuards(JwtAuthGuard)
  deleteComment(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.deleteComment(id, user);
  }

  @Patch("admin/:id")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  moderate(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ModerateArticleDto,
  ) {
    return this.articlesService.moderateArticle(id, actor, dto);
  }

  @Patch("admin/comments/:id")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  moderateComment(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ModerateArticleCommentDto,
  ) {
    return this.articlesService.moderateComment(id, actor, dto);
  }

  private visitorKey(request: Request, userId?: number): string {
    const forwardedFor = request.headers["x-forwarded-for"];
    const ip = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(",")[0] ?? request.ip ?? "unknown";
    return this.articlesService.createVisitorKey(
      request.headers["user-agent"] ?? "unknown",
      ip.trim(),
      userId,
    );
  }

}
