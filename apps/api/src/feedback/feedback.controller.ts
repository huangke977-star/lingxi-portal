import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateFeedbackDto, ListFeedbackQueryDto, ReplyFeedbackDto, UpdateFeedbackStatusDto } from "./dto/feedback.dto";
import { FeedbackService } from "./feedback.service";

@Controller("feedback")
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Get("mine")
  listMine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListFeedbackQueryDto) { return this.feedbackService.listMine(user, query); }

  @Get("inbox")
  listInbox(@CurrentUser() user: AuthenticatedUser, @Query() query: ListFeedbackQueryDto) { return this.feedbackService.listInbox(user, query); }

  @Get(":id")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) { return this.feedbackService.get(user, id); }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFeedbackDto) { return this.feedbackService.create(user, dto); }

  @Patch(":id/status")
  updateStatus(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number, @Body() dto: UpdateFeedbackStatusDto) { return this.feedbackService.updateStatus(user, id, dto); }

  @Post(":id/replies")
  reply(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number, @Body() dto: ReplyFeedbackDto) { return this.feedbackService.reply(user, id, dto); }
}
