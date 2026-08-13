import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import { AnnouncementsService } from "./announcements.service";
import { CreateAnnouncementDto, ListAnnouncementsQueryDto, UpdateAnnouncementDto } from "./dto/announcement.dto";

@Controller("announcements")
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get("public")
  listPublic(@Query() query: ListAnnouncementsQueryDto) {
    return this.announcementsService.listPublic(query);
  }

  @Get("public/:id")
  getPublic(@Param("id", ParseIntPipe) id: number) {
    return this.announcementsService.getPublic(id);
  }

  @Get("visible")
  @UseGuards(JwtAuthGuard)
  listVisible(@CurrentUser() user: AuthenticatedUser, @Query() query: ListAnnouncementsQueryDto) {
    return this.announcementsService.listVisible(user, query);
  }

  @Get("visible/unread-count")
  @UseGuards(JwtAuthGuard)
  getUnreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.announcementsService.getUnreadCount(user);
  }

  @Get("visible/:id")
  @UseGuards(JwtAuthGuard)
  getVisible(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.announcementsService.getVisible(user, id);
  }

  @Post("visible/:id/confirm")
  @UseGuards(JwtAuthGuard)
  confirmRead(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.announcementsService.confirmRead(user, id);
  }

  @Get("admin")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  listAdmin(@Query() query: ListAnnouncementsQueryDto) {
    return this.announcementsService.listAdmin(query);
  }

  @Get("admin/:id")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  getAdmin(@Param("id", ParseIntPipe) id: number) {
    return this.announcementsService.getAdmin(id);
  }

  @Post("admin")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAnnouncementDto) {
    return this.announcementsService.create(user, dto);
  }

  @Patch("admin/:id")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.announcementsService.update(user, id, dto);
  }

  @Post("admin/:id/publish")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  publish(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.announcementsService.publish(user, id);
  }

  @Post("admin/:id/archive")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.announcementsService.archive(user, id);
  }

  @Delete("admin/:id")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  delete(@Param("id", ParseIntPipe) id: number) {
    return this.announcementsService.delete(id);
  }
}
