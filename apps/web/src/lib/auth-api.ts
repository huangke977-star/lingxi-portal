import type { ThemeId } from './theme-preferences';

const CONFIGURED_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'auto';

export interface AuthRole {
  code: string;
  name: string;
  level: number;
}

export interface AuthAppearance {
  themeId: ThemeId;
  customAccent: string;
  customSurface: string;
  customForeground: string;
  customMuted: string;
  cardAlpha: number;
  glassBlur: number;
  glassTint: string;
  glassTintAlpha: number;
}

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  status: 'active' | 'disabled';
  isSuperAdmin: boolean;
  avatarUrl: string | null;
  appearance: AuthAppearance;
  role: AuthRole;
}

export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

interface ApiErrorBody {
  message?: string | string[];
}

export async function login(input: { account: string; password: string }): Promise<AuthResponse> {
  return requestJson<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function register(input: {
  username: string;
  email: string;
  password: string;
}): Promise<AuthResponse> {
  return requestJson<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function refresh(refreshToken: string): Promise<AuthResponse> {
  return requestJson<AuthResponse>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

export async function logout(refreshToken: string): Promise<void> {
  await requestJson<{ success: true }>('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

export async function getMe(accessToken: string): Promise<AuthUser> {
  return requestJson<AuthUser>('/auth/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function updateMyAppearance(accessToken: string, appearance: AuthAppearance): Promise<AuthUser> {
  return requestJson<AuthUser>('/auth/me/appearance', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(appearance),
  });
}

export async function uploadMyAvatar(accessToken: string, file: File): Promise<AuthUser> {
  const body = new FormData();
  body.append('file', file);

  return requestJson<AuthUser>('/auth/me/avatar', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body,
  });
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;

  if (!isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${getBrowserApiBaseUrl()}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json() as Promise<T>;
}

export function getBrowserApiBaseUrl(): string {
  if (CONFIGURED_API_BASE_URL !== 'auto') {
    return CONFIGURED_API_BASE_URL;
  }

  if (typeof window !== 'undefined') {
    if (window.location.port === '3000') {
      return `${window.location.protocol}//${window.location.hostname}:3001`;
    }

    return `${window.location.origin}/api`;
  }

  return 'http://localhost:3001';
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${getBrowserApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `请求失败，状态码 ${response.status}`;

  try {
    const body = (await response.json()) as ApiErrorBody;
    if (Array.isArray(body.message)) {
      return body.message[0] ?? fallback;
    }

    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}
