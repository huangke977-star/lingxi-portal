import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AnonymousTopicsService } from "./anonymous-topics.service";
import {
  ClaimAnonymousIdentityDto,
  CreateAnonymousMessageDto,
  CreateAnonymousTopicDto,
  GetAnonymousTopicQueryDto,
  ListAnonymousTopicsQueryDto,
  ReactAnonymousMessageDto,
  UpdateAnonymousMessageDto,
  UpdateAnonymousTopicByCreatorDto,
  UpdateAnonymousTopicDto,
} from "./dto/anonymous-topic.dto";

@Controller("anonymous-topics")
export class AnonymousTopicsController {
  constructor(private readonly anonymousTopicsService: AnonymousTopicsService) {}

  @Get()
  list(@Query() query: ListAnonymousTopicsQueryDto) { return this.anonymousTopicsService.list(query); }

  @Post()
  create(@Body() dto: CreateAnonymousTopicDto) { return this.anonymousTopicsService.create(dto); }

  @Post("messages/:messageId/reaction")
  react(@Param("messageId", ParseIntPipe) messageId: number, @Body() dto: ReactAnonymousMessageDto) { return this.anonymousTopicsService.react(messageId, dto); }

  @Get("admin")
  @UseGuards(JwtAuthGuard)
  listAdmin(@CurrentUser() user: AuthenticatedUser, @Query() query: ListAnonymousTopicsQueryDto) { return this.anonymousTopicsService.listAdmin(user, query); }

  @Get("admin/:id")
  @UseGuards(JwtAuthGuard)
  getAdmin(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number, @Query() query: GetAnonymousTopicQueryDto) { return this.anonymousTopicsService.getAdmin(user, id, query); }

  @Patch("admin/messages/:id")
  @UseGuards(JwtAuthGuard)
  updateMessage(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number, @Body() dto: UpdateAnonymousMessageDto) { return this.anonymousTopicsService.updateMessage(user, id, dto); }

  @Patch("admin/:id")
  @UseGuards(JwtAuthGuard)
  updateTopic(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number, @Body() dto: UpdateAnonymousTopicDto) { return this.anonymousTopicsService.updateTopic(user, id, dto); }

  @Patch(":id/status")
  updateTopicByCreator(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateAnonymousTopicByCreatorDto) { return this.anonymousTopicsService.updateTopicByCreator(id, dto); }

  @Get(":id")
  get(@Param("id", ParseIntPipe) id: number, @Query() query: GetAnonymousTopicQueryDto) { return this.anonymousTopicsService.get(id, query); }

  @Post(":id/identity")
  claimIdentity(@Param("id", ParseIntPipe) id: number, @Body() dto: ClaimAnonymousIdentityDto) { return this.anonymousTopicsService.claimIdentity(id, dto); }

  @Post(":id/messages")
  createMessage(@Param("id", ParseIntPipe) id: number, @Body() dto: CreateAnonymousMessageDto) { return this.anonymousTopicsService.createMessage(id, dto); }
}
