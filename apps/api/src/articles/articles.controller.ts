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
  CreateArticleAppealDto,
  CreateArticleDto,
  ArticleScheduleDto,
  ArticleTemplateDto,
  AutosaveArticleDto,
  ListArticleCommentsQueryDto,
  ListArticlesQueryDto,
  ModerateArticleCommentDto,
  ModerateArticleCommentReportDto,
  ModerateArticleDto,
  ModerateArticleReportDto,
  ModerateArticleAppealDto,
  RedeemArticleResourceDto,
  ReportArticleDto,
  ReportArticleCommentDto,
  UpdateReadingProgressDto,
  UpdateArticleDto,
  UpdateArticlePublishRestrictionDto,
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

  @Get("mine/dashboard")
  @UseGuards(JwtAuthGuard)
  getMineDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.getMineDashboard(user);
  }

  @Get("mine/schedules")
  @UseGuards(JwtAuthGuard)
  listMyArticleSchedules(@CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.listMyArticleSchedules(user);
  }

  @Get("mine/templates")
  @UseGuards(JwtAuthGuard)
  listMyArticleTemplates(@CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.listTemplates(user);
  }

  @Post("mine/templates")
  @UseGuards(JwtAuthGuard)
  createMyArticleTemplate(@CurrentUser() user: AuthenticatedUser, @Body() dto: ArticleTemplateDto) {
    return this.articlesService.createTemplate(user, dto);
  }

  @Patch("mine/templates/:templateId")
  @UseGuards(JwtAuthGuard)
  updateMyArticleTemplate(
    @Param("templateId", ParseIntPipe) templateId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ArticleTemplateDto,
  ) {
    return this.articlesService.updateTemplate(templateId, user, dto);
  }

  @Delete("mine/templates/:templateId")
  @UseGuards(JwtAuthGuard)
  deleteMyArticleTemplate(@Param("templateId", ParseIntPipe) templateId: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.deleteTemplate(templateId, user);
  }

  @Get("mine/reports")
  @UseGuards(JwtAuthGuard)
  listMyArticleReports(@CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.listMyArticleReports(user);
  }

  @Get("mine/reports/:id/preview")
  @UseGuards(JwtAuthGuard)
  getMyArticleReportPreview(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articlesService.getMyArticleReportPreview(id, user);
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

  @Get("subscriptions")
  @UseGuards(JwtAuthGuard)
  listSubscriptions(@Query() query: ListArticlesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.listSubscriptions(query, user);
  }

  @Get("liked")
  @UseGuards(JwtAuthGuard)
  listLiked(
    @Query() query: ListArticlesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articlesService.listLiked(query, user);
  }

  @Get("read-later")
  @UseGuards(JwtAuthGuard)
  listReadLater(
    @Query() query: ListArticlesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articlesService.listReadLater(query, user);
  }

  @Get("history")
  @UseGuards(JwtAuthGuard)
  listReadingHistory(
    @Query() query: ListArticlesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articlesService.listReadingHistory(query, user);
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

  @Get("admin/comment-reports/summary")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  getCommentReportSummary() {
    return this.articlesService.getCommentReportSummary();
  }

  @Get("admin/comment-reports")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  listCommentReports(@Query("status") status?: string) {
    return this.articlesService.listCommentReports(status);
  }

  @Get("admin/article-reports/summary")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  getArticleReportSummary() {
    return this.articlesService.getArticleReportSummary();
  }

  @Get("admin/article-reports")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  listArticleReports(@Query("status") status?: string) {
    return this.articlesService.listArticleReports(status);
  }

  @Get("admin/appeals")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  listArticleAppeals(@Query("status") status?: string) {
    return this.articlesService.listArticleAppeals(status);
  }

  @Get("admin/violations")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  listViolationAuthors() {
    return this.articlesService.listViolationAuthors();
  }

  @Get("admin/violations/:userId")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  getViolationAuthor(@Param("userId", ParseIntPipe) userId: number) {
    return this.articlesService.getViolationAuthor(userId);
  }

  @Patch("admin/violations/:userId/restriction")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  updateViolationRestriction(
    @Param("userId", ParseIntPipe) userId: number,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateArticlePublishRestrictionDto,
  ) {
    return this.articlesService.updateViolationRestriction(userId, actor, dto);
  }

  @Get("admin/:id")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  getAdminArticle(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.getAdminArticle(id, user);
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
  listComments(@Param("slug") slug: string, @Query() query: ListArticleCommentsQueryDto) {
    return this.articlesService.listComments(slug, null, query);
  }

  @Get("visible/:slug/comments")
  @UseGuards(JwtAuthGuard)
  listVisibleComments(
    @Param("slug") slug: string,
    @Query() query: ListArticleCommentsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articlesService.listComments(slug, user, query);
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

  @Post("autosave")
  @UseGuards(JwtAuthGuard)
  createAutosave(@CurrentUser() user: AuthenticatedUser, @Body() dto: AutosaveArticleDto) {
    return this.articlesService.createAutosave(user, dto);
  }

  @Post(":id/autosave")
  @UseGuards(JwtAuthGuard)
  autosave(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AutosaveArticleDto,
  ) {
    return this.articlesService.autosave(id, user, dto);
  }

  @Get(":id/versions")
  @UseGuards(JwtAuthGuard)
  listVersions(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.listVersions(id, user);
  }

  @Get(":id/versions/:versionId")
  @UseGuards(JwtAuthGuard)
  getVersion(
    @Param("id", ParseIntPipe) id: number,
    @Param("versionId", ParseIntPipe) versionId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articlesService.getVersion(id, versionId, user);
  }

  @Post(":id/versions/:versionId/restore")
  @UseGuards(JwtAuthGuard)
  restoreVersion(
    @Param("id", ParseIntPipe) id: number,
    @Param("versionId", ParseIntPipe) versionId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articlesService.restoreVersion(id, versionId, user);
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

  @Get(":id/publish-check")
  @UseGuards(JwtAuthGuard)
  publishCheck(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.getPublishCheck(id, user);
  }

  @Patch(":id/schedule")
  @UseGuards(JwtAuthGuard)
  schedule(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser, @Body() dto: ArticleScheduleDto) {
    return this.articlesService.schedule(id, user, dto);
  }

  @Post(":id/unpublish")
  @UseGuards(JwtAuthGuard)
  unpublish(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.unpublish(id, user);
  }

  @Delete("history")
  @UseGuards(JwtAuthGuard)
  clearReadingHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.clearReadingHistory(user);
  }

  @Delete("history/:id")
  @UseGuards(JwtAuthGuard)
  removeReadingHistory(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.articlesService.removeReadingHistory(id, user);
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

  @Post(":id/redeem")
  @UseGuards(JwtAuthGuard)
  redeemResource(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RedeemArticleResourceDto,
  ) {
    return this.articlesService.redeemResource(id, user, dto);
  }

  @Post(":id/read-later")
  @UseGuards(JwtAuthGuard)
  addReadLater(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.toggleReadLater(id, user, true);
  }

  @Delete(":id/read-later")
  @UseGuards(JwtAuthGuard)
  removeReadLater(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.toggleReadLater(id, user, false);
  }

  @Patch(":id/reading-progress")
  @UseGuards(JwtAuthGuard)
  updateReadingProgress(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateReadingProgressDto,
  ) {
    return this.articlesService.updateReadingProgress(id, user, dto.progress);
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

  @Post("comments/:id/like")
  @UseGuards(JwtAuthGuard)
  likeComment(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.toggleCommentLike(id, user, true);
  }

  @Delete("comments/:id/like")
  @UseGuards(JwtAuthGuard)
  unlikeComment(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.articlesService.toggleCommentLike(id, user, false);
  }

  @Post("comments/:id/report")
  @UseGuards(JwtAuthGuard)
  reportComment(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReportArticleCommentDto,
  ) {
    return this.articlesService.reportComment(id, user, dto);
  }

  @Post(":id/report")
  @UseGuards(JwtAuthGuard)
  reportArticle(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReportArticleDto,
  ) {
    return this.articlesService.reportArticle(id, user, dto);
  }

  @Post(":id/appeals")
  @UseGuards(JwtAuthGuard)
  createArticleAppeal(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateArticleAppealDto,
  ) {
    return this.articlesService.createArticleAppeal(id, user, dto);
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

  @Patch("admin/comment-reports/:id")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  moderateCommentReport(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ModerateArticleCommentReportDto,
  ) {
    return this.articlesService.moderateCommentReport(id, actor, dto);
  }

  @Patch("admin/article-reports/:id")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  moderateArticleReport(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ModerateArticleReportDto,
  ) {
    return this.articlesService.moderateArticleReport(id, actor, dto);
  }

  @Patch("admin/appeals/:id")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  moderateArticleAppeal(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ModerateArticleAppealDto,
  ) {
    return this.articlesService.moderateArticleAppeal(id, actor, dto);
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
