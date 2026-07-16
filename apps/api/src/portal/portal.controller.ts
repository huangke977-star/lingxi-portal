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
  UseGuards,
} from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import {
  CreatePortalCategoryDto,
  CreatePortalEntryDto,
  PortalListQueryDto,
  UpdatePortalCategoryDto,
  UpdatePortalEntryDto,
} from "./dto/portal.dto";
import { PortalService } from "./portal.service";
import {
  PortalCategoryResponse,
  PortalContentResponse,
  PortalEntryResponse,
} from "./portal.types";

@Controller("portal")
export class PortalController {
  constructor(private readonly portalService: PortalService) {}

  @Get("public")
  listPublic(
    @Query() query: PortalListQueryDto,
  ): Promise<PortalContentResponse> {
    return this.portalService.listPublic(query);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  listForUser(
    @Query() query: PortalListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PortalContentResponse> {
    return this.portalService.listForUser(query, user);
  }

  @Get("admin")
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  listAdmin(): Promise<PortalContentResponse> {
    return this.portalService.listAdmin();
  }

  @Post("admin/categories")
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  createCategory(
    @Body() dto: CreatePortalCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PortalCategoryResponse> {
    return this.portalService.createCategory(dto, user.id);
  }

  @Patch("admin/categories/:id")
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  updateCategory(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdatePortalCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PortalCategoryResponse> {
    return this.portalService.updateCategory(id, dto, user.id);
  }

  @Delete("admin/categories/:id")
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async deleteCategory(
    @Param("id", ParseIntPipe) id: number,
  ): Promise<{ success: true }> {
    await this.portalService.deleteCategory(id);
    return { success: true };
  }

  @Post("admin/entries")
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  createEntry(
    @Body() dto: CreatePortalEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PortalEntryResponse> {
    return this.portalService.createEntry(dto, user.id);
  }

  @Patch("admin/entries/:id")
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  updateEntry(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdatePortalEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PortalEntryResponse> {
    return this.portalService.updateEntry(id, dto, user.id);
  }

  @Delete("admin/entries/:id")
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async deleteEntry(
    @Param("id", ParseIntPipe) id: number,
  ): Promise<{ success: true }> {
    await this.portalService.deleteEntry(id);
    return { success: true };
  }
}
