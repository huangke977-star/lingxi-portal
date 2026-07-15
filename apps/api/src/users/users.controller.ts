import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import { ListUsersQueryDto } from "./dto/list-users-query.dto";
import { UpdateUserPasswordDto } from "./dto/update-user-password.dto";
import { UpdateUserRoleDto } from "./dto/update-user-role.dto";
import { UpdateUserStatusDto } from "./dto/update-user-status.dto";
import { UserListResult, UsersService } from "./users.service";

@Controller("users")
@UseGuards(JwtAuthGuard, UserManagementGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  listUsers(@Query() query: ListUsersQueryDto): Promise<UserListResult> {
    return this.usersService.listUsers(query);
  }

  @Patch(":id/role")
  assignRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateUserRoleDto,
  ): Promise<AuthenticatedUser> {
    return this.usersService.assignRole(actor, id, dto.roleCode);
  }

  @Patch(":id/status")
  setStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateUserStatusDto,
  ): Promise<AuthenticatedUser> {
    return this.usersService.setStatus(actor, id, dto.status);
  }

  @Patch(":id/nickname/reset")
  resetNickname(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
  ): Promise<AuthenticatedUser> {
    return this.usersService.resetNickname(actor, id);
  }

  @Patch(":id/password")
  updatePassword(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateUserPasswordDto,
  ): Promise<AuthenticatedUser> {
    return this.usersService.updatePassword(actor, id, dto.password);
  }
}
