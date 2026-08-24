export type UserStatus = 'active' | 'disabled';

export interface UserAppearancePreference {
  themeId: string;
  customAccent: string;
  customSurface: string;
  customForeground: string;
  customMuted: string;
  cardAlpha: number;
  glassBlur: number;
  glassTint: string;
  glassTintAlpha: number;
}

export interface AuthenticatedUser {
  id: number;
  username: string;
  nickname: string;
  email: string;
  emailVerifiedAt?: Date | null;
  authVersion?: number;
  status: UserStatus;
  isSuperAdmin: boolean;
  isAdministrator?: boolean;
  avatarUrl: string | null;
  profileBio: string;
  locale?: "zh-CN" | "en-US";
  createdAt: Date;
  appearance: UserAppearancePreference;
  role: {
    code: string;
    name: string;
    level: number;
  };
}

export interface AuthResponse {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshSessionContext {
  ip: string;
  userAgent: string;
  deviceId?: string;
  trustedDeviceToken?: string;
}

export interface AuthSessionSummary {
  id: string;
  issuedAt: string;
  expiresAt: string;
  ip: string;
  userAgent: string;
  current: boolean;
}

export interface DeviceLoginVerificationRequired {
  deviceVerificationRequired: true;
  challengeToken: string;
  emailHint: string;
  expiresAt: string;
  retryAfterSeconds: number;
}

export type LoginResponse = AuthResponse | DeviceLoginVerificationRequired;

export interface AccessTokenPayload {
  sub: number;
  username: string;
  sid?: string;
  av?: number;
}
