import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import { UsersService, AVATAR_MAX_FILE_SIZE_BYTES } from '../users/users.service';
import { UpdateUserAppearanceDto } from '../users/dto/update-user-appearance.dto';
import { UpdateUserProfileDto } from '../users/dto/update-user-profile.dto';
import { AuthService } from './auth.service';
import { AuthResponse, AuthenticatedUser } from './auth.types';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('register')
  @HttpCode(200)
  register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() request: { ip?: string }): Promise<AuthResponse> {
    return this.authService.login(dto, request.ip ?? 'unknown');
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthResponse> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshTokenDto): Promise<{ success: true }> {
    return this.authService.logout(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return this.authService.me(user);
  }

  @Patch('me/appearance')
  @UseGuards(JwtAuthGuard)
  updateAppearance(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserAppearanceDto,
  ): Promise<AuthenticatedUser> {
    return this.usersService.updateOwnAppearance(user.id, dto);
  }

  @Patch('me/profile')
  @UseGuards(JwtAuthGuard)
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateUserProfileDto): Promise<AuthenticatedUser> {
    return this.usersService.updateOwnProfile(user.id, dto);
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: AVATAR_MAX_FILE_SIZE_BYTES, files: 1 } }))
  uploadAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string; size: number } | undefined,
  ): Promise<AuthenticatedUser> {
    return this.usersService.updateOwnAvatar(user.id, file);
  }

  @Get('avatars/:storedName')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async getAvatar(@Param('storedName') storedName: string): Promise<StreamableFile> {
    const file = await this.usersService.getAvatarFile(storedName);
    return new StreamableFile(createReadStream(file.filePath), { type: file.mimeType });
  }
}
