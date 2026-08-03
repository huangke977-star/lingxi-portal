import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SearchQueryDto } from "./dto/search.dto";
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
}
