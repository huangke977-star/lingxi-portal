import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ListMessagesQueryDto, RespondFriendRequestDto } from "./dto/social.dto";
import { SocialService } from "./social.service";

@Controller("social")
@UseGuards(JwtAuthGuard)
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  @Get("profiles/:id")
  getProfile(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.getProfile(user, id);
  }

  @Get("friends")
  listFriends(@CurrentUser() user: AuthenticatedUser) {
    return this.socialService.listFriendships(user);
  }

  @Post("friends/:id/request")
  requestFriend(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.requestFriend(user, id);
  }

  @Patch("friendships/:id/respond")
  respondFriendRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: RespondFriendRequestDto,
  ) {
    return this.socialService.respondFriendRequest(user, id, dto.status);
  }

  @Delete("friendships/:id")
  removeFriendship(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.removeFriendship(user, id);
  }

  @Get("summary")
  getSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.socialService.getSummary(user);
  }

  @Get("conversations")
  listConversations(@CurrentUser() user: AuthenticatedUser) {
    return this.socialService.listConversations(user);
  }

  @Post("conversations/with/:id")
  getOrCreateConversation(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.getOrCreateConversation(user, id);
  }

  @Get("conversations/:id/messages")
  listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.socialService.listMessages(user, id, query);
  }

  @Post("conversations/:id/read")
  markRead(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.socialService.markConversationRead(user.id, id);
  }
}
