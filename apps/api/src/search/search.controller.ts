import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { HotSearchQueryDto, RecordSearchDto, SearchQueryDto } from "./dto/search.dto";
import { SearchService } from "./search.service";

@Controller("search")
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get("public")
  searchPublic(@Query() query: SearchQueryDto) {
    return this.searchService.search(query, null);
  }

  @Get("visible")
  @UseGuards(JwtAuthGuard)
  searchVisible(@Query() query: SearchQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.searchService.search(query, user);
  }

  @Get("hot")
  listHot(@Query() query: HotSearchQueryDto) {
    return this.searchService.listHot(query.limit);
  }

  @Get("history")
  @UseGuards(JwtAuthGuard)
  listHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.searchService.listHistory(user.id);
  }

  @Post("history")
  @UseGuards(JwtAuthGuard)
  recordSearch(@Body() dto: RecordSearchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.searchService.recordSearch(dto.keyword, user.id);
  }

  @Delete("history")
  @UseGuards(JwtAuthGuard)
  clearHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.searchService.clearHistory(user.id);
  }

  @Delete("history/:id")
  @UseGuards(JwtAuthGuard)
  deleteHistory(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.searchService.deleteHistory(id, user.id);
  }
}
