import { Body, Controller, Get, Header, Ip, Param, ParseIntPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DistributionService } from "./distribution.service";
import { UpdateSubscriptionEmailPreferenceDto } from "./dto/distribution.dto";

@Controller("distribution")
export class DistributionController {
  constructor(private readonly distributionService: DistributionService) {}

  @Get("feeds/site.rss")
  @Header("Content-Type", "application/rss+xml; charset=utf-8")
  siteRss(@Ip() ip: string) {
    return this.distributionService.renderFeed({ kind: "site", path: "/api/distribution/feeds/site.rss", title: "HLOVET" }, "rss", ip);
  }

  @Get("feeds/site.atom")
  @Header("Content-Type", "application/atom+xml; charset=utf-8")
  siteAtom(@Ip() ip: string) {
    return this.distributionService.renderFeed({ kind: "site", path: "/api/distribution/feeds/site.atom", title: "HLOVET" }, "atom", ip);
  }

  @Get("feeds/authors/:username.rss")
  @Header("Content-Type", "application/rss+xml; charset=utf-8")
  authorRss(@Param("username") username: string, @Ip() ip: string) {
    return this.distributionService.renderFeed({ kind: "author", path: `/api/distribution/feeds/authors/${encodeURIComponent(username)}.rss`, title: `@${username}`, username }, "rss", ip);
  }

  @Get("feeds/authors/:username.atom")
  @Header("Content-Type", "application/atom+xml; charset=utf-8")
  authorAtom(@Param("username") username: string, @Ip() ip: string) {
    return this.distributionService.renderFeed({ kind: "author", path: `/api/distribution/feeds/authors/${encodeURIComponent(username)}.atom`, title: `@${username}`, username }, "atom", ip);
  }

  @Get("feeds/topics/:slug.rss")
  @Header("Content-Type", "application/rss+xml; charset=utf-8")
  topicRss(@Param("slug") slug: string, @Ip() ip: string) {
    return this.distributionService.renderFeed({ kind: "topic", path: `/api/distribution/feeds/topics/${encodeURIComponent(slug)}.rss`, title: slug, slug }, "rss", ip);
  }

  @Get("feeds/topics/:slug.atom")
  @Header("Content-Type", "application/atom+xml; charset=utf-8")
  topicAtom(@Param("slug") slug: string, @Ip() ip: string) {
    return this.distributionService.renderFeed({ kind: "topic", path: `/api/distribution/feeds/topics/${encodeURIComponent(slug)}.atom`, title: slug, slug }, "atom", ip);
  }

  @Get("feeds/collections/:id.rss")
  @Header("Content-Type", "application/rss+xml; charset=utf-8")
  collectionRss(@Param("id", ParseIntPipe) id: number, @Ip() ip: string) {
    return this.distributionService.renderFeed({ kind: "collection", path: `/api/distribution/feeds/collections/${id}.rss`, title: `Collection ${id}`, id }, "rss", ip);
  }

  @Get("feeds/collections/:id.atom")
  @Header("Content-Type", "application/atom+xml; charset=utf-8")
  collectionAtom(@Param("id", ParseIntPipe) id: number, @Ip() ip: string) {
    return this.distributionService.renderFeed({ kind: "collection", path: `/api/distribution/feeds/collections/${id}.atom`, title: `Collection ${id}`, id }, "atom", ip);
  }

  @Get("sitemap")
  getSitemap() {
    return this.distributionService.getSitemapEntries();
  }

  @Get("articles/:slug/metadata")
  getArticleMetadata(@Param("slug") slug: string) {
    return this.distributionService.getPublicArticleMetadata(slug);
  }

  @Get("email")
  @UseGuards(JwtAuthGuard)
  getEmailSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.distributionService.getEmailSettings(user);
  }

  @Patch("email")
  @UseGuards(JwtAuthGuard)
  updateEmailSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateSubscriptionEmailPreferenceDto) {
    return this.distributionService.updateEmailSettings(user, dto);
  }

  @Post("email/unsubscribe/:token")
  unsubscribeEmail(@Param("token") token: string) {
    return this.distributionService.unsubscribeByToken(token);
  }
}
