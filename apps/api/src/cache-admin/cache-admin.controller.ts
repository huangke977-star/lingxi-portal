import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { CacheAdminService } from "./cache-admin.service";
import {
  CacheDeleteResponse,
  CacheKeyDetailResponse,
  CacheKeyPageResponse,
  CacheKeySummary,
  CacheOverviewResponse,
} from "./cache-admin.types";
import {
  DeleteCacheKeysDto,
  InspectCacheKeyDto,
  ListCacheKeysQueryDto,
  UpdateCacheKeyTtlDto,
  UpdateCacheKeysTtlDto,
} from "./dto/cache-admin.dto";

@Controller("admin/cache")
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class CacheAdminController {
  constructor(private readonly cacheAdminService: CacheAdminService) {}

  @Get("overview")
  getOverview(): Promise<CacheOverviewResponse> {
    return this.cacheAdminService.getOverview();
  }

  @Get("keys")
  listKeys(
    @Query() query: ListCacheKeysQueryDto,
  ): Promise<CacheKeyPageResponse> {
    return this.cacheAdminService.listKeys(query);
  }

  @Post("inspect")
  @HttpCode(200)
  inspectKey(@Body() dto: InspectCacheKeyDto): Promise<CacheKeyDetailResponse> {
    return this.cacheAdminService.inspectKey(dto);
  }

  @Post("delete")
  @HttpCode(200)
  deleteKeys(@Body() dto: DeleteCacheKeysDto): Promise<CacheDeleteResponse> {
    return this.cacheAdminService.deleteKeys(dto);
  }

  @Patch("ttl")
  updateTtl(@Body() dto: UpdateCacheKeyTtlDto): Promise<CacheKeySummary> {
    return this.cacheAdminService.updateTtl(dto);
  }

  @Patch("ttl/bulk")
  updateTtls(
    @Body() dto: UpdateCacheKeysTtlDto,
  ): Promise<CacheKeySummary[]> {
    return this.cacheAdminService.updateTtls(dto);
  }
}
