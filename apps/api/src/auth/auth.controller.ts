import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseIntPipe, Patch, Post, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { createReadStream } from "node:fs";
import { UsersService, AVATAR_MAX_FILE_SIZE_BYTES } from "../users/users.service";
import { UpdateUserAppearanceDto } from "../users/dto/update-user-appearance.dto";
import { UpdateUserProfileDto } from "../users/dto/update-user-profile.dto";
import { UpdateUserLocaleDto } from "../users/dto/update-user-locale.dto";
import { AuthService } from "./auth.service";
import { AuthResponse, AuthenticatedUser, AuthSessionSummary, DeviceLoginResponse, LoginResponse, RefreshSessionContext } from "./auth.types";
import { CurrentSessionId } from "./current-session-id.decorator";
import { CurrentUser } from "./current-user.decorator";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { DeviceLoginVerificationDto, DeviceLoginVerificationResendDto, LoginDto, TotpLoginVerificationDto } from "./dto/login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { RegisterDto } from "./dto/register.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { AccountSecurityService } from "../security/account-security.service";
import { SecurityConfigurationService } from "../security/security-configuration.service";
import { ConfirmEmailVerificationDto, PasswordRecoveryRequestDto, PasswordRecoveryResetDto, RegistrationCodeDto, UpdateSecurityPreferencesDto } from "../security/dto/security.dto";
import { createTrustedDeviceToken, readTrustedDeviceToken, setTrustedDeviceCookie } from "./trusted-device-cookie";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly accountSecurity: AccountSecurityService,
    private readonly securityConfiguration: SecurityConfigurationService,
  ) {}

  @Get("security-policy")
  securityPolicy() {
    return this.securityConfiguration.getPublicPolicy();
  }

  @Post("registration-code")
  @HttpCode(200)
  requestRegistrationCode(@Body() dto: RegistrationCodeDto, @Req() request: SessionRequest) {
    return this.accountSecurity.requestRegistrationCode(dto.email, dto.turnstileToken, this.sessionContext(request));
  }

  @Post("password-recovery/request")
  @HttpCode(200)
  requestPasswordRecovery(@Body() dto: PasswordRecoveryRequestDto, @Req() request: SessionRequest) {
    return this.accountSecurity.requestPasswordReset(dto.email, dto.turnstileToken, this.sessionContext(request));
  }

  @Post("password-recovery/reset")
  @HttpCode(200)
  resetPassword(@Body() dto: PasswordRecoveryResetDto, @Req() request: SessionRequest) {
    return this.authService.resetPassword(dto, this.sessionContext(request));
  }

  @Post("register")
  @HttpCode(200)
  async register(@Body() dto: RegisterDto, @Req() request: SessionRequest, @Res({ passthrough: true }) response: Response): Promise<AuthResponse> {
    const context = this.sessionContext(request);
    const shouldSetCookie = !context.trustedDeviceToken;
    context.trustedDeviceToken ??= createTrustedDeviceToken();
    const result = await this.authService.register(dto, context);
    if (shouldSetCookie) setTrustedDeviceCookie(response, context.trustedDeviceToken);
    return result;
  }

  @Post("login")
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() request: SessionRequest, @Res({ passthrough: true }) response: Response): Promise<LoginResponse> {
    const context = this.sessionContext(request);
    const shouldSetCookie = !context.trustedDeviceToken;
    context.trustedDeviceToken ??= createTrustedDeviceToken();
    const result = await this.authService.login(dto, context);
    if (shouldSetCookie) setTrustedDeviceCookie(response, context.trustedDeviceToken);
    return result;
  }

  @Post("login/device-verification")
  @HttpCode(200)
  verifyDeviceLogin(@Body() dto: DeviceLoginVerificationDto, @Req() request: SessionRequest): Promise<DeviceLoginResponse> {
    return this.authService.verifyDeviceLogin(dto, this.sessionContext(request));
  }

  @Post("login/totp-verification")
  @HttpCode(200)
  verifyTotpLogin(@Body() dto: TotpLoginVerificationDto, @Req() request: SessionRequest): Promise<AuthResponse> {
    return this.authService.verifyTotpLogin(dto, this.sessionContext(request));
  }

  @Post("login/device-verification/resend")
  @HttpCode(200)
  resendDeviceLoginVerification(@Body() dto: DeviceLoginVerificationResendDto, @Req() request: SessionRequest) {
    return this.accountSecurity.resendDeviceLoginVerification(dto.challengeToken, this.sessionContext(request));
  }

  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto, @Req() request: SessionRequest): Promise<AuthResponse> {
    return this.authService.refresh(dto.refreshToken, this.sessionContext(request));
  }

  @Post("logout")
  @HttpCode(200)
  logout(@Body() dto: RefreshTokenDto): Promise<{ success: true }> {
    return this.authService.logout(dto.refreshToken);
  }

  @Post("sessions")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  sessions(@CurrentUser() user: AuthenticatedUser, @CurrentSessionId() sessionId: string | null, @Req() request: SessionRequest): Promise<{ sessions: AuthSessionSummary[] }> {
    return this.authService.listSessions(user.id, sessionId, this.sessionContext(request));
  }

  @Post("sessions/revoke-others")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  revokeOtherSessions(@CurrentUser() user: AuthenticatedUser, @CurrentSessionId() sessionId: string | null): Promise<{ revokedSessions: number }> {
    return this.authService.revokeOtherSessions(user.id, sessionId);
  }

  @Post("sessions/revoke-all")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  revokeAllSessions(@CurrentUser() user: AuthenticatedUser): Promise<{ revokedSessions: number }> {
    return this.authService.revokeAllSessions(user.id);
  }

  @Delete("sessions/:sessionId")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  revokeSession(@CurrentUser() user: AuthenticatedUser, @CurrentSessionId() currentSessionId: string | null, @Param("sessionId") targetSessionId: string): Promise<{ success: true; current: boolean }> {
    return this.authService.revokeSession(user.id, currentSessionId, targetSessionId);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return this.authService.me(user);
  }

  @Patch("me/appearance")
  @UseGuards(JwtAuthGuard)
  updateAppearance(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateUserAppearanceDto): Promise<AuthenticatedUser> {
    return this.usersService.updateOwnAppearance(user.id, dto);
  }

  @Patch("me/profile")
  @UseGuards(JwtAuthGuard)
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateUserProfileDto): Promise<AuthenticatedUser> {
    return this.usersService.updateOwnProfile(user.id, dto);
  }

  @Patch("me/locale")
  @UseGuards(JwtAuthGuard)
  updateLocale(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateUserLocaleDto): Promise<AuthenticatedUser> {
    return this.usersService.updateOwnLocale(user.id, dto);
  }

  @Patch("me/password")
  @UseGuards(JwtAuthGuard)
  changePassword(@CurrentUser() user: AuthenticatedUser, @CurrentSessionId() sessionId: string | null, @Body() dto: ChangePasswordDto, @Req() request: SessionRequest): Promise<{ success: true; revokedSessions: number }> {
    return this.authService.changePassword(user, sessionId, dto, this.sessionContext(request));
  }

  @Get("me/security")
  @UseGuards(JwtAuthGuard)
  getMySecurity(@CurrentUser() user: AuthenticatedUser, @Req() request: SessionRequest) {
    return this.accountSecurity.getMySecurity(user.id, this.sessionContext(request));
  }

  @Delete("me/security/trusted-devices/:deviceId")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  cancelTrustedDevice(@CurrentUser() user: AuthenticatedUser, @Param("deviceId", ParseIntPipe) deviceId: number, @Req() request: SessionRequest): Promise<{ success: true; current: boolean }> {
    return this.accountSecurity.cancelTrustedDevice(user.id, deviceId, this.sessionContext(request));
  }

  @Patch("me/security/preferences")
  @UseGuards(JwtAuthGuard)
  updateMySecurityPreferences(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateSecurityPreferencesDto) {
    return this.accountSecurity.updatePreferences(user.id, dto);
  }

  @Post("me/email-verification/send")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  sendMyEmailVerification(@CurrentUser() user: AuthenticatedUser, @Req() request: SessionRequest) {
    return this.accountSecurity.sendAccountEmailCode(user, this.sessionContext(request));
  }

  @Post("me/email-verification/confirm")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  confirmMyEmailVerification(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConfirmEmailVerificationDto, @Req() request: SessionRequest) {
    return this.accountSecurity.confirmAccountEmail(user, dto, this.sessionContext(request));
  }

  @Post("me/avatar")
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: AVATAR_MAX_FILE_SIZE_BYTES, files: 1 },
    }),
  )
  uploadAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number } | undefined,
  ): Promise<AuthenticatedUser> {
    return this.usersService.updateOwnAvatar(user.id, file);
  }

  @Get("avatars/:storedName")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  async getAvatar(@Param("storedName") storedName: string): Promise<StreamableFile> {
    const file = await this.usersService.getAvatarFile(storedName);
    return new StreamableFile(createReadStream(file.filePath), {
      type: file.mimeType,
    });
  }

  private sessionContext(request: SessionRequest): RefreshSessionContext {
    const forwardedFor = request.headers?.["x-forwarded-for"];
    const userAgent = request.headers?.["user-agent"];
    const deviceId = request.headers?.["x-device-id"];
    const forwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0];
    return {
      ip: normalizeIp(forwardedIp?.trim() || request.ip || "unknown"),
      userAgent: Array.isArray(userAgent) ? (userAgent[0] ?? "unknown") : (userAgent ?? "unknown"),
      deviceId: Array.isArray(deviceId) ? deviceId[0] : deviceId,
      trustedDeviceToken: readTrustedDeviceToken(Array.isArray(request.headers?.cookie) ? request.headers.cookie[0] : request.headers?.cookie),
    };
  }
}

interface SessionRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

function normalizeIp(ip: string): string {
  return ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
}
