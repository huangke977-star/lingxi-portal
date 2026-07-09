export type UserStatus = 'active' | 'disabled';

export interface AuthenticatedUser {
  id: number;
  username: string;
  email: string;
  status: UserStatus;
  isSuperAdmin: boolean;
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
