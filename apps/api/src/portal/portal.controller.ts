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
import { UserManagementGuard } from "../auth/guards/user-management.guard";
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
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  listAdmin(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PortalContentResponse> {
    return this.portalService.listAdmin(user);
  }

  @Post("admin/categories")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  createCategory(
    @Body() dto: CreatePortalCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PortalCategoryResponse> {
    return this.portalService.createCategory(dto, user);
  }

  @Patch("admin/categories/:id")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  updateCategory(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdatePortalCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PortalCategoryResponse> {
    return this.portalService.updateCategory(id, dto, user);
  }

  @Delete("admin/categories/:id")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  async deleteCategory(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true }> {
    await this.portalService.deleteCategory(id, user);
    return { success: true };
  }

  @Post("admin/entries")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  createEntry(
    @Body() dto: CreatePortalEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PortalEntryResponse> {
    return this.portalService.createEntry(dto, user);
  }

  @Patch("admin/entries/:id")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  updateEntry(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdatePortalEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PortalEntryResponse> {
    return this.portalService.updateEntry(id, dto, user);
  }

  @Delete("admin/entries/:id")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  async deleteEntry(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true }> {
    await this.portalService.deleteEntry(id, user);
    return { success: true };
  }
}
