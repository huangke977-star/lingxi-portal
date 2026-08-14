import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateSuggestionDto, ListSuggestionsQueryDto, ReplySuggestionDto, ReviewSuggestionDto } from "./dto/suggestion.dto";
import { SuggestionsService } from "./suggestions.service";

@Controller("suggestions")
export class SuggestionsController {
  constructor(private readonly suggestionsService: SuggestionsService) {}

  @Get()
  listPublic(@Query() query: ListSuggestionsQueryDto) { return this.suggestionsService.listPublic(query); }

  @Get("mine")
  @UseGuards(JwtAuthGuard)
  listMine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListSuggestionsQueryDto) { return this.suggestionsService.listMine(user, query); }

  @Get("inbox")
  @UseGuards(JwtAuthGuard)
  listInbox(@CurrentUser() user: AuthenticatedUser, @Query() query: ListSuggestionsQueryDto) { return this.suggestionsService.listInbox(user, query); }

  @Get(":id")
  getPublic(@Param("id", ParseIntPipe) id: number) { return this.suggestionsService.getPublic(id); }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSuggestionDto) { return this.suggestionsService.create(user, dto); }

  @Patch(":id/status")
  @UseGuards(JwtAuthGuard)
  review(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number, @Body() dto: ReviewSuggestionDto) { return this.suggestionsService.review(user, id, dto); }

  @Post(":id/replies")
  @UseGuards(JwtAuthGuard)
  reply(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number, @Body() dto: ReplySuggestionDto) { return this.suggestionsService.reply(user, id, dto); }
}
