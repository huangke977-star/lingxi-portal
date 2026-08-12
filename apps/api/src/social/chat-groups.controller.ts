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
import {
  CreateChatGroupDto,
  HandleChatGroupReportDto,
  InviteChatGroupMembersDto,
  ListChatGroupReportsQueryDto,
  ReportChatGroupMessageDto,
  RequestChatGroupJoinDto,
  RespondChatGroupInvitationDto,
  RespondChatGroupJoinRequestDto,
  SearchChatGroupsQueryDto,
  TransferChatGroupOwnerDto,
  UpdateChatGroupAliasDto,
  UpdateChatGroupDto,
  UpdateChatGroupMemberDto,
} from "./dto/social.dto";
import {
  ChatGroupsService,
  GROUP_AVATAR_MAX_FILE_SIZE_BYTES,
  UploadedGroupAvatar,
} from "./chat-groups.service";

@Controller("social")
@UseGuards(JwtAuthGuard)
export class ChatGroupsController {
  constructor(private readonly groupsService: ChatGroupsService) {}

  @Get("groups")
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.groupsService.listMine(user);
  }

  @Get("groups/search")
  search(@CurrentUser() user: AuthenticatedUser, @Query() query: SearchChatGroupsQueryDto) {
    return this.groupsService.search(user, query);
  }

  @Get("group-invitations")
  listInvitations(@CurrentUser() user: AuthenticatedUser) {
    return this.groupsService.listInvitations(user);
  }

  @Get("group-approvals")
  listApprovals(@CurrentUser() user: AuthenticatedUser) {
    return this.groupsService.listApprovals(user);
  }

  @Patch("group-invitations/:id/respond")
  respondInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: RespondChatGroupInvitationDto,
  ) {
    return this.groupsService.respondInvitation(user, id, dto);
  }

  @Patch("groups/:id/invitation/respond")
  respondInvitationByGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: RespondChatGroupInvitationDto,
  ) {
    return this.groupsService.respondInvitationByGroup(user, id, dto);
  }

  @Get("group-reports")
  listReports(@CurrentUser() user: AuthenticatedUser, @Query() query: ListChatGroupReportsQueryDto) {
    return this.groupsService.listReports(user, query);
  }

  @Patch("group-reports/:id")
  handleReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: HandleChatGroupReportDto,
  ) {
    return this.groupsService.handleReport(user, id, dto);
  }

  @Post("groups")
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateChatGroupDto) {
    return this.groupsService.create(user, dto);
  }

  @Get("groups/:id")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.groupsService.get(user, id);
  }

  @Patch("groups/:id")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateChatGroupDto,
  ) {
    return this.groupsService.update(user, id, dto);
  }

  @Post("groups/:id/avatar")
  @UseInterceptors(FileInterceptor("file", { limits: { files: 1, fileSize: GROUP_AVATAR_MAX_FILE_SIZE_BYTES } }))
  uploadAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @UploadedFile() file: UploadedGroupAvatar | undefined,
  ) {
    return this.groupsService.uploadAvatar(user, id, file);
  }

  @Patch("groups/:id/alias")
  updateAlias(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateChatGroupAliasDto,
  ) {
    return this.groupsService.updateAlias(user, id, dto);
  }

  @Post("groups/:id/invitations")
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: InviteChatGroupMembersDto,
  ) {
    return this.groupsService.invite(user, id, dto);
  }

  @Post("groups/:id/join-requests")
  requestJoin(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: RequestChatGroupJoinDto,
  ) {
    return this.groupsService.requestJoin(user, id, dto);
  }

  @Get("groups/:id/join-requests")
  listJoinRequests(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.groupsService.listJoinRequests(user, id);
  }

  @Patch("groups/:id/join-requests/:requestId")
  respondJoinRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Param("requestId", ParseIntPipe) requestId: number,
    @Body() dto: RespondChatGroupJoinRequestDto,
  ) {
    return this.groupsService.respondJoinRequest(user, id, requestId, dto);
  }

  @Patch("groups/:id/members/:userId")
  updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Param("userId", ParseIntPipe) userId: number,
    @Body() dto: UpdateChatGroupMemberDto,
  ) {
    return this.groupsService.updateMember(user, id, userId, dto);
  }

  @Delete("groups/:id/members/:userId")
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Param("userId", ParseIntPipe) userId: number,
  ) {
    return this.groupsService.removeMember(user, id, userId);
  }

  @Post("groups/:id/members/:userId/block")
  blockMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Param("userId", ParseIntPipe) userId: number,
  ) {
    return this.groupsService.blockMember(user, id, userId);
  }

  @Delete("groups/:id/members/:userId/block")
  unblockMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Param("userId", ParseIntPipe) userId: number,
  ) {
    return this.groupsService.unblockMember(user, id, userId);
  }

  @Post("groups/:id/transfer")
  transferOwner(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: TransferChatGroupOwnerDto,
  ) {
    return this.groupsService.transferOwner(user, id, dto);
  }

  @Post("groups/:id/leave")
  leave(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.groupsService.leave(user, id);
  }

  @Delete("groups/:id")
  dissolve(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.groupsService.dissolve(user, id);
  }

  @Post("groups/:id/messages/:messageId/reports")
  reportMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Param("messageId", ParseIntPipe) messageId: number,
    @Body() dto: ReportChatGroupMessageDto,
  ) {
    return this.groupsService.reportMessage(user, id, messageId, dto);
  }

  @Get("groups/:id/activity")
  listActivity(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.groupsService.listActivity(user, id);
  }
}

@Controller("social/groups/avatars")
export class ChatGroupAvatarsController {
  constructor(private readonly groupsService: ChatGroupsService) {}

  @Get(":storedName")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  async getAvatar(@Param("storedName") storedName: string): Promise<StreamableFile> {
    const file = await this.groupsService.getAvatar(storedName);
    return new StreamableFile(createReadStream(file.filePath), { type: file.mimeType });
  }
}
