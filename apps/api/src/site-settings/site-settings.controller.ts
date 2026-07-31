import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import {
  UpsertArticleTaxonomyDto,
  UpdateSiteSettingsDto,
} from "./dto/site-settings.dto";
import { SiteSettingsService } from "./site-settings.service";
import {
  ArticleTaxonomyResponse,
  SiteSettingsResponse,
} from "./site-settings.types";

@Controller("site-settings")
export class SiteSettingsController {
  constructor(private readonly siteSettingsService: SiteSettingsService) {}

  @Get("public")
  getPublicSettings(): Promise<SiteSettingsResponse> {
    return this.siteSettingsService.getPublicSettings();
  }

  @Get()
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  getAdminSettings(): Promise<SiteSettingsResponse> {
    return this.siteSettingsService.getAdminSettings();
  }

  @Patch()
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  updateSettings(@Body() dto: UpdateSiteSettingsDto): Promise<SiteSettingsResponse> {
    return this.siteSettingsService.updateSettings(dto);
  }

  @Post("taxonomies")
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  createTaxonomy(@Body() dto: UpsertArticleTaxonomyDto): Promise<ArticleTaxonomyResponse> {
    return this.siteSettingsService.createTaxonomy(dto);
  }

  @Patch("taxonomies/:id")
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  updateTaxonomy(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpsertArticleTaxonomyDto,
  ): Promise<ArticleTaxonomyResponse> {
    return this.siteSettingsService.updateTaxonomy(id, dto);
  }

  @Delete("taxonomies/:id")
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async deleteTaxonomy(@Param("id", ParseIntPipe) id: number): Promise<{ success: true }> {
    await this.siteSettingsService.deleteTaxonomy(id);
    return { success: true };
  }
}
