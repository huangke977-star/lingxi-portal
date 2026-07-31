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
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { createReadStream } from "node:fs";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import {
  UpsertArticleTaxonomyDto,
  UpdateSiteSettingsDto,
} from "./dto/site-settings.dto";
import {
  SITE_ASSET_MAX_FILE_SIZE_BYTES,
  SiteAssetsService,
  UploadedSiteAssetFile,
} from "./site-assets.service";
import { SiteSettingsService } from "./site-settings.service";
import {
  ArticleTaxonomyResponse,
  SiteAssetResponse,
  SiteSettingsResponse,
} from "./site-settings.types";

@Controller("site-settings")
export class SiteSettingsController {
  constructor(
    private readonly siteSettingsService: SiteSettingsService,
    private readonly siteAssetsService: SiteAssetsService,
  ) {}

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

  @Post("reset")
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  resetSettings(): Promise<SiteSettingsResponse> {
    return this.siteSettingsService.resetSettings();
  }

  @Get("assets")
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  listAssets(@Query("kind") kind?: string): Promise<SiteAssetResponse[]> {
    return this.siteAssetsService.list(kind);
  }

  @Post("assets")
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: SITE_ASSET_MAX_FILE_SIZE_BYTES } }))
  uploadAsset(
    @Body("kind") kind: string | undefined,
    @UploadedFile() file: UploadedSiteAssetFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SiteAssetResponse> {
    return this.siteAssetsService.upload(kind, file, user.id);
  }

  @Get("assets/files/:storedName")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  async getAssetFile(@Param("storedName") storedName: string): Promise<StreamableFile> {
    const file = await this.siteAssetsService.getFile(storedName);
    return new StreamableFile(createReadStream(file.filePath), { type: file.mimeType });
  }

  @Delete("assets/:id")
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async deleteAsset(@Param("id", ParseIntPipe) id: number): Promise<{ success: true }> {
    await this.siteAssetsService.delete(id);
    return { success: true };
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
