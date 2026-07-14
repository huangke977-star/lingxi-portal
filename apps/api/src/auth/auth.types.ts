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
  email: string;
  status: UserStatus;
  isSuperAdmin: boolean;
  avatarUrl: string | null;
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

export interface AccessTokenPayload {
  sub: number;
  username: string;
}
