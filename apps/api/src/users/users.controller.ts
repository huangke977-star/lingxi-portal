import { Body, Controller, Get, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { AuthenticatedUser } from '../auth/auth.types';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  listUsers(): Promise<AuthenticatedUser[]> {
    return this.usersService.listUsers();
  }

  @Patch(':id/role')
  assignRole(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserRoleDto): Promise<AuthenticatedUser> {
    return this.usersService.assignRole(id, dto.roleCode);
  }

  @Patch(':id/status')
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserStatusDto): Promise<AuthenticatedUser> {
    return this.usersService.setStatus(id, dto.status);
  }
}
